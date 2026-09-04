/// <reference lib="webworker" />
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type RuntimeCaching,
} from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

// Serwist generates this list at build time — it's every precached asset
// (JS chunks, images under /public, icons, manifest). We just hand it off.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Runtime caching policy. We deliberately do NOT use Serwist's defaultCache:
// it stores every /api/* JSON response and every rendered page in Cache
// Storage for 24 h (ignoring Cache-Control: no-store), which meant todos,
// budget pages and the daily photo (with its GPS) stayed on a shared or lost
// device after sign-out. Personal data is network-only; only build assets,
// icons and fonts are cached.
const STATIC_CACHE = "static-assets-v2";
const FONT_CACHE = "google-fonts-v2";
const KEEP_CACHES = new Set([STATIC_CACHE, FONT_CACHE]);

const runtimeCaching: RuntimeCaching[] = [
  { matcher: ({ url }) => url.pathname.startsWith("/api/"), handler: new NetworkOnly() },
  { matcher: ({ request }) => request.mode === "navigate", handler: new NetworkOnly() },
  {
    matcher: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: STATIC_CACHE,
      plugins: [new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  {
    matcher: ({ sameOrigin, url }) =>
      sameOrigin &&
      !url.pathname.startsWith("/api/") &&
      /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(url.pathname),
    handler: new StaleWhileRevalidate({
      cacheName: STATIC_CACHE,
      plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 })],
    }),
  },
  {
    matcher: ({ url }) =>
      url.origin === "https://fonts.gstatic.com" || url.origin === "https://fonts.googleapis.com",
    handler: new CacheFirst({
      cacheName: FONT_CACHE,
      plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 365 * 24 * 60 * 60 })],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

serwist.addEventListeners();

// Drop the caches an earlier worker created under defaultCache ("apis",
// "pages", "next-image", …). Serwist never cleans those up on its own, so
// without this they would keep serving stale personal data after the upgrade.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !KEEP_CACHES.has(k) && !k.includes("precache"))
          .map((k) => caches.delete(k))
      )
    )
  );
});
