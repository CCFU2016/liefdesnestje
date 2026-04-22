import { cookies } from "next/headers";
import { auth } from "./config";

// Tiny in-memory cache for "is this session cookie attached to a signed-in
// user?" Used on hot read paths (e.g. the recipe image route, which gets
// 20+ parallel hits per page load) to avoid slamming the DB with a session
// lookup per image.
//
// Keyed by the raw session-token cookie value. Invalidated by TTL — that's
// fine for our threat model: a stolen cookie is already a full compromise,
// and the cache never extends a session's lifetime beyond the TTL window.

const TTL_MS = 60 * 1000; // 60s — tight enough that sign-out takes effect quickly
const MAX_ENTRIES = 512;

type CacheEntry = { userId: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  for (const name of SESSION_COOKIE_NAMES) {
    const v = store.get(name)?.value;
    if (v) return v;
  }
  return null;
}

/**
 * Resolve the caller's userId using a short-lived in-memory cache. Returns
 * null if the caller isn't signed in. Call sites that need richer context
 * (household, role) should still use `requireHouseholdMember()`.
 */
export async function getCachedUserId(): Promise<string | null> {
  const token = await readSessionCookie();
  if (!token) return null;

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expiresAt > now) {
    return hit.userId;
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    // Negative-cache is dangerous (race with fresh sign-in); skip it.
    cache.delete(token);
    return null;
  }

  // Evict oldest when over capacity.
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(token, { userId, expiresAt: now + TTL_MS });
  return userId;
}
