import "server-only";
import { readBodyCapped, safeFetch } from "@/lib/safe-fetch";

// Apple's iCloud "Shared Albums" feature exposes a public JSON feed per share
// token. The same endpoints Apple's own web viewer (share.icloud.com) uses,
// documented by community projects like `icloud-shared-album` on npm.
//
// The protocol has two calls:
//   1. webstream        → list photos + derivatives (no URLs yet)
//   2. webasseturls     → exchange photoGuids for signed, short-lived URLs
//
// The share token encodes which server partition the album lives on. We don't
// hardcode a partition; instead we start at p123 and follow the 330 redirect
// response (Apple returns `{"X-Apple-MMe-Host": "..."}` in the body) until we
// land on the right one. Bouncing is cheap and removes the need to reverse-
// engineer the character-to-partition mapping.

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Liefdesnestje/1.0";

export type SharedPhoto = {
  photoGuid: string;
  width: number;
  height: number;
  dateCreated: string | null;
  caption: string | null;
  contributorFirstName: string | null;
  contributorLastName: string | null;
  mediaAssetType: "image" | "video";
  // Derivatives keyed by label ("1920", "2048", "PosterFrame", etc.)
  derivatives: Record<
    string,
    { checksum: string; fileSize: number; width: number; height: number }
  >;
};

export type WebstreamResponse = {
  streamCtag: string;
  streamName: string | null;
  photos: SharedPhoto[];
};

export class ICloudAlbumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ICloudAlbumError";
  }
}

/**
 * Extract the token from a shared album URL. Accepts the three forms Apple
 * has shipped over the years:
 *   https://www.icloud.com/sharedalbum/#B0XXXXX       (legacy, hash)
 *   https://share.icloud.com/photos/0XXXXX            (modern, path)
 *   https://share.icloud.com/photos/#0XXXXX           (rare, hash)
 *   B0XXXXX                                           (bare token paste)
 */
export function parseAlbumToken(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const tokenRe = /^[A-Za-z0-9_-]{6,80}$/;
  // Bare token paste
  if (tokenRe.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith("icloud.com")) return null;
  // Prefer the hash when present — that's the "canonical" album id in the
  // legacy URL form. Fall back to the last path segment for modern URLs
  // (share.icloud.com/photos/TOKEN).
  if (url.hash && url.hash.length > 1) {
    const t = url.hash.replace(/^#/, "");
    if (tokenRe.test(t)) return t;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg === "sharedalbum" || seg === "photos") continue;
    if (tokenRe.test(seg)) return seg;
  }
  return null;
}

// All iCloud requests share a per-call timeout; otherwise a hung request
// would stall the whole route until Railway's gateway kills it — which
// prevents any of our console.logs from flushing.
const ICLOUD_TIMEOUT_MS = 12_000;
// The full-album webstream listing is a different beast: Apple takes ~50s
// for a 1000-photo album (measured Aug 2026). One pick per day can afford
// to wait.
const WEBSTREAM_TIMEOUT_MS = 120_000;

// Response-size caps. Small JSON exchanges (redirect bounce, webasseturls)
// are a few KB; the full webstream listing of a 1000-photo album with all
// its derivatives is ~1-2 MB, so give that one more headroom.
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_WEBSTREAM_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

async function postJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number = ICLOUD_TIMEOUT_MS,
  maxBytes: number = MAX_JSON_BYTES
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await safeFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
    { maxBytes }
  );
  const text = new TextDecoder().decode(await readBodyCapped(res, maxBytes));
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // some 330 redirects return text/html or empty body; keep parsed=null
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

/**
 * Resolve the partition base URL for a token. Returns something like
 *   https://p42-sharedstreams.icloud.com/<token>/sharedstreams/
 *
 * iCloud returns HTTP 330 with {"X-Apple-MMe-Host": "..."} telling us the
 * correct host when the album lives on a different partition. We try a small
 * list of known-good seeds: any of them responds with either 200 (we landed
 * on the right one) or 330 (redirect to the right one). If all seeds 404,
 * the token is dead.
 */
const SEED_PARTITIONS = [4, 23, 42, 123, 50, 70, 100] as const;

export async function resolveBaseUrl(token: string): Promise<string> {
  const build = (part: number) =>
    `https://p${part.toString().padStart(2, "0")}-sharedstreams.icloud.com/${token}/sharedstreams/`;

  const tryAt = async (base: string): Promise<{ ok: true; base: string } | { ok: false; next: string } | { ok: false; dead: true; status: number }> => {
    // The winning hop of this probe IS the full webstream listing — for a
    // 1000-photo album Apple takes ~50s, so it needs the long timeout too
    // (the 330 redirect hops answer in under a second regardless).
    const { status, body, headers } = await postJson(
      `${base}webstream`,
      { streamCtag: null },
      WEBSTREAM_TIMEOUT_MS,
      MAX_WEBSTREAM_BYTES
    );
    if (status === 200) return { ok: true, base };
    if (status === 330) {
      const redirectHost =
        ((body as { "X-Apple-MMe-Host"?: string } | null)?.["X-Apple-MMe-Host"]) ??
        headers.get("x-apple-mme-host");
      if (redirectHost) {
        // The host comes from the response body — only ever follow it to
        // Apple's own domain, so a tampered reply can't point us elsewhere.
        if (!/^[a-z0-9.-]+\.icloud\.com$/i.test(redirectHost)) {
          throw new ICloudAlbumError(`iCloud redirected to unexpected host "${redirectHost}"`);
        }
        return { ok: false, next: `https://${redirectHost}/${token}/sharedstreams/` };
      }
    }
    return { ok: false, dead: true, status };
  };

  let lastStatus = 0;
  for (const seed of SEED_PARTITIONS) {
    let base = build(seed);
    for (let hop = 0; hop < 3; hop++) {
      const r = await tryAt(base);
      if ("dead" in r) {
        lastStatus = r.status;
        break; // try next seed
      }
      if (r.ok) return r.base;
      base = r.next;
    }
  }
  throw new ICloudAlbumError(
    `iCloud returned ${lastStatus || "no-usable-status"} for every partition seed — the album may be private, expired, or the link needs to be re-copied.`
  );
}

/** Fetch the full webstream (photo list). Includes all derivatives metadata. */
export async function fetchWebstream(baseUrl: string): Promise<WebstreamResponse> {
  // Retry once on timeout — big albums are slow AND occasionally flaky.
  let res: Awaited<ReturnType<typeof postJson>>;
  try {
    res = await postJson(
      `${baseUrl}webstream`,
      { streamCtag: null },
      WEBSTREAM_TIMEOUT_MS,
      MAX_WEBSTREAM_BYTES
    );
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      res = await postJson(
        `${baseUrl}webstream`,
        { streamCtag: null },
        WEBSTREAM_TIMEOUT_MS,
        MAX_WEBSTREAM_BYTES
      );
    } else {
      throw e;
    }
  }
  const { status, body } = res;
  if (status !== 200) {
    throw new ICloudAlbumError(`webstream responded ${status}`);
  }
  const raw = body as {
    streamCtag?: string;
    streamName?: string;
    photos?: Array<Record<string, unknown>>;
  };
  const photos: SharedPhoto[] = (raw.photos ?? []).map((p) => {
    const derivatives = (p.derivatives as Record<string, Record<string, unknown>>) ?? {};
    const normalized: SharedPhoto["derivatives"] = {};
    for (const [label, d] of Object.entries(derivatives)) {
      normalized[label] = {
        checksum: String(d.checksum ?? ""),
        fileSize: parseInt(String(d.fileSize ?? "0"), 10),
        width: parseInt(String(d.width ?? "0"), 10),
        height: parseInt(String(d.height ?? "0"), 10),
      };
    }
    return {
      photoGuid: String(p.photoGuid ?? ""),
      width: parseInt(String(p.width ?? "0"), 10),
      height: parseInt(String(p.height ?? "0"), 10),
      dateCreated: (p.dateCreated as string | undefined) ?? null,
      caption: ((p.caption as string | undefined) ?? "").trim() || null,
      contributorFirstName: (p.contributorFirstName as string | undefined) ?? null,
      contributorLastName: (p.contributorLastName as string | undefined) ?? null,
      mediaAssetType: (p.mediaAssetType as "image" | "video" | undefined) ?? "image",
      derivatives: normalized,
    };
  });
  return {
    streamCtag: String(raw.streamCtag ?? ""),
    streamName: ((raw.streamName as string | undefined) ?? "").trim() || null,
    photos,
  };
}

/**
 * Exchange photo guids for signed, short-lived download URLs. Apple returns
 * a normalized shape with `items` (keyed by checksum) and `locations` (hosts).
 * We stitch them together per-photo and return a lookup by guid.
 */
export async function fetchAssetUrls(
  baseUrl: string,
  photoGuids: string[]
): Promise<Record<string, Record<string, string>>> {
  if (photoGuids.length === 0) return {};
  const { status, body } = await postJson(`${baseUrl}webasseturls`, {
    photoGuids,
  });
  if (status !== 200) {
    throw new ICloudAlbumError(`webasseturls responded ${status}`);
  }
  // Dump the raw response shape until we understand what Apple is sending.
  // Truncate to a few hundred chars so we don't spam logs with mega-strings.
  const rawStr = JSON.stringify(body ?? {}).slice(0, 600);
  // Only the shape, never the body: it carries signed asset URLs.
  console.log("[icloud] webasseturls raw:", rawStr.length, "bytes");

  const raw = body as {
    items?: Record<
      string,
      { url_expiry?: string; url_location?: string; url_path?: string }
    >;
    // Current Apple response uses { hosts: [...] }; older docs reference
    // a single { hostname }. Support both, and fall back to using the
    // url_location key itself as the hostname (which is what current
    // responses look like — locations are keyed by hostname directly).
    locations?: Record<
      string,
      { hostname?: string; hosts?: string[]; scheme?: string }
    >;
  };
  const items = raw.items ?? {};
  const locations = raw.locations ?? {};
  const checksumToUrl: Record<string, string> = {};
  for (const [checksum, item] of Object.entries(items)) {
    if (!item.url_location || !item.url_path) continue;
    const loc = locations[item.url_location];
    const host = loc?.hosts?.[0] ?? loc?.hostname ?? item.url_location;
    if (!host) continue;
    const scheme = loc?.scheme ?? "https";
    checksumToUrl[checksum] = `${scheme}://${host}${item.url_path}`;
  }
  return { _flat: checksumToUrl };
}

/**
 * Choose the largest derivative that isn't insanely huge. We cap at 2048px to
 * keep downloads under a few MB each; anything smaller we just take as-is.
 */
export function pickBestDerivative(photo: SharedPhoto): {
  label: string;
  checksum: string;
  width: number;
  height: number;
} | null {
  const candidates = Object.entries(photo.derivatives)
    .filter(([label]) => label !== "PosterFrame" && !isNaN(parseInt(label, 10)))
    .map(([label, d]) => ({ label, ...d }))
    .sort((a, b) => b.width - a.width);
  // Prefer widest <=2048, else smallest available (at least it's real).
  const under = candidates.find((c) => c.width <= 2048);
  const pick = under ?? candidates[candidates.length - 1] ?? null;
  return pick ? { label: pick.label, checksum: pick.checksum, width: pick.width, height: pick.height } : null;
}

/**
 * Download the derivative bytes for a single photo. Returns { bytes, mime }.
 * The MIME is inferred from the URL or defaults to image/jpeg (iCloud serves
 * HEIC as JPEG in derivatives).
 */
export async function downloadAsset(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await safeFetch(
    url,
    {
      headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "image/*" },
      signal: AbortSignal.timeout(ICLOUD_TIMEOUT_MS * 2), // download may take longer
    },
    { maxBytes: MAX_ASSET_BYTES }
  );
  if (!res.ok) {
    throw new ICloudAlbumError(`asset download ${res.status}`);
  }
  const buf = await readBodyCapped(res, MAX_ASSET_BYTES);
  const ctype = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { bytes: buf, mime: ctype || "image/jpeg" };
}
