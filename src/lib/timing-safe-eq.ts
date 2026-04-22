import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Safe against timing attacks used to
 * recover shared secrets (webhook HMACs, CSRF tokens, etc.) one byte at
 * a time.
 *
 * Node's `timingSafeEqual` requires equal-length buffers or it throws —
 * we hash both sides to a fixed-length SHA-256 first to handle unequal
 * inputs without leaking length via error vs return path. Actually for
 * webhooks the secret length is public (env-configured), so the simpler
 * path is to length-check first (early reject) and then compare.
 *
 * Both approaches are fine for this threat model. We go with the simple
 * length-pad path since unequal-length inputs are always tampered anyway.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still do a dummy compare against `bb` vs `bb` so the branch cost is
    // symmetric — this isn't strictly necessary but costs nothing.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
