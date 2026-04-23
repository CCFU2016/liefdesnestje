// Derive the public origin reliably behind a proxy (e.g. Railway). Prefers
// explicit env vars, then X-Forwarded-* headers, then the request URL as a
// last-resort fallback. Both the initiating route and the callback need to
// compute *the same* URL — Google's token exchange compares them byte-for-byte.
// Post-flow redirects to /settings also use this origin so the browser
// doesn't get bounced to Railway's internal host (e.g. localhost:8080).

export function getPublicOrigin(hdrs: Headers, reqUrl: string): string {
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // fall through
    }
  }
  const forwardedHost = hdrs.get("x-forwarded-host");
  const host = forwardedHost ?? hdrs.get("host");
  const proto =
    hdrs.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host) return `${proto}://${host}`;
  return new URL(reqUrl).origin;
}

export function getLinkGoogleRedirectUri(hdrs: Headers, reqUrl: string): string {
  return `${getPublicOrigin(hdrs, reqUrl)}/api/auth/link-google/callback`;
}
