import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readBodyCapped, safeFetch, SafeFetchError } from "@/lib/safe-fetch";
import { sniffMime } from "@/lib/file-magic";

export const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? (process.env.NODE_ENV === "production" ? "/data/uploads" : "./.local-uploads");

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10MB

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const DOC_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

export function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

export async function saveUpload(input: {
  subdir: string; // e.g. "recipes" or "holidays/<id>"
  filename?: string; // if absent, we generate a UUID
  bytes: Uint8Array;
  mime: string;
}): Promise<{ path: string; relPath: string; fileName: string }> {
  const dir = join(UPLOAD_ROOT, input.subdir);
  await mkdir(dir, { recursive: true });

  const ext = extForMime(input.mime);
  const name = input.filename ?? `${randomUUID()}.${ext}`;
  // Defend against path traversal without mangling the extension. The
  // previous regex [/\\..] was a bug — `.` inside a character class is
  // literal, and the redundant `..` just meant "match any dot twice",
  // so every `.` (including the extension separator) got turned into _.
  // That's why recipe URLs ended up as abc_jpg instead of abc.jpg.
  const safeName = basename(name).replace(/[\\/]/g, "_").replace(/\.\./g, "_");
  const full = join(dir, safeName);
  await writeFile(full, input.bytes);
  return { path: full, relPath: join(input.subdir, safeName), fileName: safeName };
}

/**
 * Fetch a remote image and persist it to the uploads volume. Returns the
 * app-served URL (e.g. "/api/uploads/recipes/<uuid>.jpg") on success, or null
 * if the URL is unreachable, not an image, or too large.
 *
 * Used for TikTok/Instagram thumbnails (CDN URLs are signed and expire) and
 * recipe-site og:image (host sometimes goes away).
 */
export async function downloadAndSaveImage(
  remoteUrl: string,
  subdir = "recipes"
): Promise<string | null> {
  try {
    const res = await safeFetch(
      remoteUrl,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Liefdesnestje/1.0",
          Accept: "image/*",
        },
      },
      { maxBytes: MAX_IMAGE_BYTES }
    );
    if (!res.ok) return null;

    const ctypeRaw = res.headers.get("content-type") ?? "";
    const claimed = ctypeRaw.split(";")[0].trim().toLowerCase();
    if (!IMAGE_MIME_TYPES.includes(claimed as ImageMime)) return null;

    // Throws BodyTooLargeError (a SafeFetchError) past the cap → null below.
    const bytes = await readBodyCapped(res, MAX_IMAGE_BYTES);
    if (bytes.length === 0) return null;

    // The remote Content-Type is only a hint; the extension we write (and
    // later serve with) must come from what the bytes actually are, or an
    // HTML/SVG payload could land on disk as ".jpg".
    const sniffed = sniffMime(bytes);
    if (!sniffed || !IMAGE_MIME_TYPES.includes(sniffed as ImageMime)) return null;
    const mime = sniffed as ImageMime;

    const { relPath } = await saveUpload({ subdir, bytes, mime });
    // relPath is "<subdir>/<filename>" — the serve route is
    //   /api/uploads/<subdir>/<path...>
    const inner = relPath.split("/").slice(1).join("/");
    return `/api/uploads/${subdir}/${inner}`;
  } catch (e) {
    if (e instanceof SafeFetchError) {
      console.warn("downloadAndSaveImage blocked by safeFetch:", e.message);
    }
    return null;
  }
}
