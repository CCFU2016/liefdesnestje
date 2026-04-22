import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// Baseline security headers applied to every response. We skip a strict CSP
// for now because Next's hydration needs inline scripts/styles and a proper
// nonce-per-request flow is a bigger lift — X-Frame-Options + frame-ancestors
// still kills the clickjacking vector.
const SECURITY_HEADERS = [
  // Force HTTPS for 2y; include subdomains; allow preload list submission.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Prevent MIME sniffing of responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URL on cross-origin navigation.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Belt-and-braces clickjacking protection (paired with frame-ancestors in CSP).
  { key: "X-Frame-Options", value: "DENY" },
  // Disable browser features we don't use.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()",
  },
  // Minimal CSP: mostly to block framing. Allow inline for Next hydration.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "node-ical",
    "ical.js",
    "rrule",
    "moment",
    "moment-timezone",
    "axios",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Don't run the service worker in dev — it caches aggressively and makes
  // HMR confusing. Enable with `pnpm dev` + setting SERWIST_DEV=1 if you
  // specifically want to test offline behavior.
  disable: process.env.NODE_ENV === "development" && process.env.SERWIST_DEV !== "1",
});

export default withSerwist(nextConfig);
