// Derive the public origin reliably behind a proxy (e.g. Railway). Prefers
// explicit env vars, then X-Forwarded-* headers, then the request URL as a
// last-resort fallback. Both the initiating route and the callback need to
// compute *the same* URL — Google's token exchange compares them byte-for-byte.

export function getLinkGoogleRedirectUri(hdrs: Headers, reqUrl: string): string {
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      return `${u.origin}/api/auth/link-google/callback`;
    } catch {
      // fall through to header-based detection
    }
  }
  const forwardedHost = hdrs.get("x-forwarded-host");
  const host = forwardedHost ?? hdrs.get("host");
  const proto =
    hdrs.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) return `${proto}://${host}/api/auth/link-google/callback`;
  const url = new URL(reqUrl);
  return `${url.origin}/api/auth/link-google/callback`;
}
