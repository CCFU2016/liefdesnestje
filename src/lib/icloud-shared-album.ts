import "server-only";
import { safeFetch } from "@/lib/safe-fetch";

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

async function postJson(
  url: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await safeFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
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
 * correct host when the album lives on a different partition. Start with a
 * partition known to exist (so we either get 200 or a 330 redirect, never
 * an outright 404 that'd have us giving up early).
 */
export async function resolveBaseUrl(token: string, seedPartition = 23): Promise<string> {
  const build = (part: number) =>
    `https://p${part.toString().padStart(2, "0")}-sharedstreams.icloud.com/${token}/sharedstreams/`;

  const tryAt = async (base: string) => {
    const { status, body, headers } = await postJson(`${base}webstream`, {
      streamCtag: null,
    });
    if (status === 200) return { ok: true as const, base };
    if (status === 330) {
      const redirectHost =
        ((body as { "X-Apple-MMe-Host"?: string } | null)?.["X-Apple-MMe-Host"]) ??
        headers.get("x-apple-mme-host");
      if (redirectHost) {
        return { ok: false as const, next: `https://${redirectHost}/${token}/sharedstreams/` };
      }
    }
    // 400/403/404 here means the token itself isn't recognised. 500/502
    // are usually transient but still not something a retry against the
    // same partition will fix. Surface the status for debugging.
    throw new ICloudAlbumError(
      `iCloud returned ${status} for token — the album may be private, expired, or the link needs to be re-copied.`
    );
  };

  let base = build(seedPartition);
  for (let hop = 0; hop < 3; hop++) {
    const r = await tryAt(base);
    if (r.ok) return r.base;
    base = r.next;
  }
  throw new ICloudAlbumError("Too many partition redirects from iCloud");
}

/** Fetch the full webstream (photo list). Includes all derivatives metadata. */
export async function fetchWebstream(baseUrl: string): Promise<WebstreamResponse> {
  const { status, body } = await postJson(`${baseUrl}webstream`, { streamCtag: null });
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
  const raw = body as {
    items?: Record<
      string,
      { url_expiry?: string; url_location?: string; url_path?: string }
    >;
    locations?: Record<string, { hostname?: string; scheme?: string }>;
  };
  const items = raw.items ?? {};
  const locations = raw.locations ?? {};
  // Invert: we want per-photoGuid, map checksum → url.
  // That's actually returned in the webstream already (derivatives store
  // checksums). Here we return a map keyed by checksum → absolute URL.
  const checksumToUrl: Record<string, string> = {};
  for (const [checksum, item] of Object.entries(items)) {
    if (!item.url_location || !item.url_path) continue;
    const loc = locations[item.url_location];
    if (!loc?.hostname) continue;
    const scheme = loc.scheme ?? "https";
    checksumToUrl[checksum] = `${scheme}://${loc.hostname}${item.url_path}`;
  }
  // The caller has the derivatives map per photo — we return { guid: { checksum: url } }
  // but since Apple returns a flat items map, we just return {flat: checksumToUrl}.
  // Caller uses pickBestDerivative() to choose the right checksum.
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
  const res = await safeFetch(url, {
    headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "image/*" },
  });
  if (!res.ok) {
    throw new ICloudAlbumError(`asset download ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const ctype = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  return { bytes: buf, mime: ctype || "image/jpeg" };
}
