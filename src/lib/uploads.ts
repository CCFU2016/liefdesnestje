import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
}): Promise<{ path: string; relPath: string }> {
  const dir = join(UPLOAD_ROOT, input.subdir);
  await mkdir(dir, { recursive: true });

  const ext = extForMime(input.mime);
  const name = input.filename ?? `${randomUUID()}.${ext}`;
  // defend against path traversal in supplied filenames
  const safeName = name.replace(/[/\\..]/g, "_");
  const full = join(dir, safeName);
  await writeFile(full, input.bytes);
  return { path: full, relPath: join(input.subdir, safeName) };
}
