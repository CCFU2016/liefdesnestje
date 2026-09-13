import { z } from "zod";
import { ahFetch } from "./client";
import { AH_CLIENT_ID, AH_PATHS, AH_REDIRECT_PREFIX } from "./constants";

// Tokens. Anonymous ones are cached in memory (product search, recipes and
// bonus need nothing more). Member tokens are stored per household by
// connection.ts; this file only talks to the token endpoints.

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  /** Absolute expiry of the access token. */
  expiresAt: Date;
};

const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(4096),
    refresh_token: z.string().min(1).max(4096),
    expires_in: z.number().int().positive(),
  })
  .passthrough();

function toPair(json: unknown, now = new Date()): TokenPair {
  const t = TokenResponseSchema.parse(json);
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(now.getTime() + t.expires_in * 1000),
  };
}

/**
 * Pulls the authorization code out of whatever the user pasted: the bare
 * code, the full `appie://login-exit?code=…` URL, or the Chrome console line
 * that quotes it. Returns null when nothing code-shaped is there.
 */
export function extractAuthCode(input: string): string | null {
  const s = input.trim();
  if (!s || s.length > 2048) return null;
  const m = s.match(/[?&]code=([A-Za-z0-9._~-]+)/);
  if (m) return m[1];
  if (s.startsWith(AH_REDIRECT_PREFIX)) return null;
  // A bare code: AH issues UUID-like codes; accept the same character set
  // without a query string around it.
  if (/^[A-Za-z0-9._~-]{16,200}$/.test(s)) return s;
  return null;
}

/** True when the access token expires within `skewMs` (default 5 minutes). */
export function shouldRefresh(expiresAt: Date, now = new Date(), skewMs = 5 * 60 * 1000): boolean {
  return expiresAt.getTime() - now.getTime() <= skewMs;
}

export async function exchangeCode(code: string): Promise<TokenPair> {
  const { json } = await ahFetch(AH_PATHS.exchangeCode, {
    method: "POST",
    body: { clientId: AH_CLIENT_ID, code },
  });
  return toPair(json);
}

/** The refresh token rotates: always store the pair this returns. */
export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const { json } = await ahFetch(AH_PATHS.refreshToken, {
    method: "POST",
    body: { clientId: AH_CLIENT_ID, refreshToken },
  });
  return toPair(json);
}

/** Best effort: AH forgets the refresh token; failures are swallowed. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await ahFetch(AH_PATHS.logout, {
      method: "POST",
      body: { clientId: AH_CLIENT_ID, refreshToken },
    });
  } catch {
    // The row is deleted regardless; a stale token on AH's side expires by itself.
  }
}

// --- anonymous token -------------------------------------------------------

let anonymous: { token: string; expiresAt: Date } | null = null;
let anonymousInFlight: Promise<string> | null = null;

// Renew an hour before expiry so a request never starts on a token that dies
// mid-flight. Anonymous tokens live seven days.
const ANONYMOUS_SKEW_MS = 60 * 60 * 1000;

export async function getAnonymousToken(now = new Date()): Promise<string> {
  if (anonymous && !shouldRefresh(anonymous.expiresAt, now, ANONYMOUS_SKEW_MS)) return anonymous.token;
  if (!anonymousInFlight) {
    anonymousInFlight = (async () => {
      try {
        const { json } = await ahFetch(AH_PATHS.anonymousToken, {
          method: "POST",
          body: { clientId: AH_CLIENT_ID },
        });
        const pair = toPair(json, now);
        anonymous = { token: pair.accessToken, expiresAt: pair.expiresAt };
        return pair.accessToken;
      } finally {
        anonymousInFlight = null;
      }
    })();
  }
  return anonymousInFlight;
}

/** Test hook: forget the cached anonymous token. */
export function _resetAnonymousTokenForTests() {
  anonymous = null;
  anonymousInFlight = null;
}
