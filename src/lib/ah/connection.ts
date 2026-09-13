import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ahConnections } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/auth/encryption";
import { advisoryLockAcquired } from "@/lib/calendar-sync/helpers";
import { exchangeCode, refreshTokens, revokeRefreshToken, shouldRefresh, type TokenPair } from "./auth";
import { AhAuthError } from "./client";

// The household's Albert Heijn connection: one row, one AH account, tokens
// encrypted at rest. Everything that needs a member token goes through
// withAhConnection() so refreshes are serialised and failures are recorded
// where Settings can show them.

export class AhNotConnectedError extends Error {
  constructor() {
    super("Albert Heijn is not connected");
    this.name = "AhNotConnectedError";
  }
}

export class AhReconnectError extends Error {
  constructor() {
    super("The Albert Heijn connection needs to be renewed");
    this.name = "AhReconnectError";
  }
}

export type AhConnectionStatus = {
  connected: boolean;
  needsReconnect: boolean;
  connectedByUserId: string | null;
  connectedAt: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
};

type Row = typeof ahConnections.$inferSelect;

async function loadRow(householdId: string): Promise<Row | null> {
  const rows = await db.select().from(ahConnections).where(eq(ahConnections.householdId, householdId)).limit(1);
  return rows[0] ?? null;
}

export async function getAhConnectionStatus(householdId: string): Promise<AhConnectionStatus> {
  const row = await loadRow(householdId);
  if (!row) {
    return { connected: false, needsReconnect: false, connectedByUserId: null, connectedAt: null, lastUsedAt: null, lastError: null };
  }
  return {
    connected: true,
    needsReconnect: row.needsReconnect,
    connectedByUserId: row.connectedByUserId,
    connectedAt: row.createdAt,
    lastUsedAt: row.lastSyncedAt,
    lastError: row.lastError,
  };
}

function encryptedColumns(pair: TokenPair) {
  return {
    accessTokenEnc: encrypt(pair.accessToken),
    refreshTokenEnc: encrypt(pair.refreshToken),
    expiresAt: pair.expiresAt,
  };
}

/** Exchanges a freshly pasted login code and stores the tokens for the household. */
export async function connectHousehold(input: { householdId: string; userId: string; code: string }): Promise<void> {
  const pair = await exchangeCode(input.code);
  const now = new Date();
  await db
    .insert(ahConnections)
    .values({
      householdId: input.householdId,
      connectedByUserId: input.userId,
      ...encryptedColumns(pair),
      needsReconnect: false,
      lastError: null,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: ahConnections.householdId,
      set: {
        connectedByUserId: input.userId,
        ...encryptedColumns(pair),
        needsReconnect: false,
        lastError: null,
        lastSyncedAt: now,
        updatedAt: now,
      },
    });
}

/** Revokes the refresh token at AH (best effort) and forgets the connection. */
export async function disconnectHousehold(householdId: string): Promise<void> {
  const row = await loadRow(householdId);
  if (!row) return;
  try {
    await revokeRefreshToken(decrypt(row.refreshTokenEnc));
  } catch {
    // never block a disconnect on AH being down
  }
  await db.delete(ahConnections).where(eq(ahConnections.householdId, householdId));
}

export async function recordAhSuccess(householdId: string): Promise<void> {
  await db
    .update(ahConnections)
    .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(ahConnections.householdId, householdId));
}

export async function recordAhFailure(householdId: string, message: string): Promise<void> {
  await db
    .update(ahConnections)
    .set({ lastError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(ahConnections.householdId, householdId));
}

async function markNeedsReconnect(householdId: string): Promise<void> {
  await db
    .update(ahConnections)
    .set({ needsReconnect: true, lastError: "Albert Heijn no longer accepts the saved login", updatedAt: new Date() })
    .where(eq(ahConnections.householdId, householdId));
}

// --- refresh, serialised per household -------------------------------------

const inFlight = new Map<string, Promise<TokenPair | null>>();

function usesPglite(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return !url || url.startsWith("pglite://") || url === "pglite";
}

/**
 * Refreshes the household's tokens exactly once even when several requests
 * notice the expiry together. The refresh token rotates, so two concurrent
 * refreshes would leave one of them with a dead pair.
 *
 * In-process: one promise per household. Across instances (Postgres): a
 * transaction-scoped advisory lock; whoever loses the lock waits and re-reads
 * the row the winner wrote. PGlite is a single connection and cannot nest
 * queries inside a transaction, so there the promise map is the only guard.
 */
async function refreshSerialised(householdId: string, force: boolean): Promise<TokenPair | null> {
  const existing = inFlight.get(householdId);
  if (existing) return existing;
  const task = (async () => {
    try {
      if (usesPglite()) return await refreshIfNeeded(householdId, force);
      const result = await db.transaction(async (tx) => {
        const res = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${"ah:" + householdId})) AS locked`);
        if (!advisoryLockAcquired(res)) return "busy" as const;
        return await refreshIfNeeded(householdId, force);
      });
      if (result !== "busy") return result;
      // Another instance holds the lock: give it a moment, then use its result.
      await new Promise((r) => setTimeout(r, 750));
      return await currentPair(householdId);
    } finally {
      inFlight.delete(householdId);
    }
  })();
  inFlight.set(householdId, task);
  return task;
}

async function currentPair(householdId: string): Promise<TokenPair | null> {
  const row = await loadRow(householdId);
  if (!row || row.needsReconnect) return null;
  return { accessToken: decrypt(row.accessTokenEnc), refreshToken: decrypt(row.refreshTokenEnc), expiresAt: row.expiresAt };
}

async function refreshIfNeeded(householdId: string, force: boolean): Promise<TokenPair | null> {
  // Re-read under the lock: the row may already carry a fresh pair.
  const row = await loadRow(householdId);
  if (!row || row.needsReconnect) return null;
  const pair: TokenPair = {
    accessToken: decrypt(row.accessTokenEnc),
    refreshToken: decrypt(row.refreshTokenEnc),
    expiresAt: row.expiresAt,
  };
  if (!force && !shouldRefresh(pair.expiresAt)) return pair;
  try {
    const fresh = await refreshTokens(pair.refreshToken);
    await db
      .update(ahConnections)
      .set({ ...encryptedColumns(fresh), needsReconnect: false, lastError: null, updatedAt: new Date() })
      .where(eq(ahConnections.householdId, householdId));
    return fresh;
  } catch (e) {
    if (e instanceof AhAuthError) {
      await markNeedsReconnect(householdId);
      return null;
    }
    await recordAhFailure(householdId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** A valid member access token for the household, refreshing first when close to expiry. */
export async function getHouseholdAhToken(householdId: string): Promise<string> {
  const row = await loadRow(householdId);
  if (!row) throw new AhNotConnectedError();
  if (row.needsReconnect) throw new AhReconnectError();
  if (!shouldRefresh(row.expiresAt)) return decrypt(row.accessTokenEnc);
  const pair = await refreshSerialised(householdId, false);
  if (!pair) throw new AhReconnectError();
  return pair.accessToken;
}

/**
 * Runs `fn` with a member token. One rejected call triggers one forced
 * refresh and one retry; a second rejection marks the connection as needing
 * a new login. Success and failure are recorded on the row.
 */
export async function withAhConnection<T>(householdId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getHouseholdAhToken(householdId);
  try {
    const out = await fn(token);
    await recordAhSuccess(householdId);
    return out;
  } catch (e) {
    if (e instanceof AhAuthError) {
      const pair = await refreshSerialised(householdId, true);
      if (!pair) throw new AhReconnectError();
      try {
        const out = await fn(pair.accessToken);
        await recordAhSuccess(householdId);
        return out;
      } catch (e2) {
        if (e2 instanceof AhAuthError) {
          await markNeedsReconnect(householdId);
          throw new AhReconnectError();
        }
        await recordAhFailure(householdId, e2 instanceof Error ? e2.message : String(e2));
        throw e2;
      }
    }
    await recordAhFailure(householdId, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
