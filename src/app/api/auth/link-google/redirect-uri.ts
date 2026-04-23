// Derive the public origin reliably behind a proxy (e.g. Railway). Prefers
// explicit env vars, then X-Forwarded-* headers, then the request URL as a
// last-resort fallback. Both the initiating route and the callback need to
// compute *the same* URL — Google's token exchange compares them byte-for-byte.
// Post-flow redirects to /settings also use this origin so the browser
// doesn't get bounced to Railway's internal host (e.g. localhost:8080).

export function getPublicOrigin(hdrs: Headers, reqUrl: string): string {
  // Prefer the headers the proxy sets — they're always the URL the user
  // actually typed. AUTH_URL / NEXTAUTH_URL are only used as a last resort
  // because they're easy to misconfigure (we've seen Railway deploys with
  // AUTH_URL pointing at an internal http://localhost:8080 which then
  // leaks into OAuth redirects).
  const forwardedHost = hdrs.get("x-forwarded-host");
  const host = forwardedHost ?? hdrs.get("host");
  const proto =
    hdrs.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  if (host && !host.startsWith("localhost")) return `${proto}://${host}`;

  // Headers missing (or localhost). Try env next, ignoring any value that
  // looks like a local address when we're in prod.
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (!(process.env.NODE_ENV === "production" && isLocal)) {
        return u.origin;
      }
    } catch {
      // fall through
    }
  }

  // Final fallback — whatever the framework gave us on req.url.
  if (host) return `${proto}://${host}`;
  return new URL(reqUrl).origin;
}

export function getLinkGoogleRedirectUri(hdrs: Headers, reqUrl: string): string {
  return `${getPublicOrigin(hdrs, reqUrl)}/api/auth/link-google/callback`;
}
