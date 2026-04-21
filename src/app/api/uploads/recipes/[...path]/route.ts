import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Public serve for recipe images. Filenames are random UUIDs (see
// src/lib/uploads.ts), so URLs are unguessable and never exposed outside
// the authed app. We used to gate this with a session check, but that
// added one DB round-trip per image — when the recipe list loads 20+
// pictures in parallel, the connection pool fills up and images start
// failing with 401s. The UUID-as-capability is a reasonable privacy
// boundary for a 2-person household app.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const rel = normalize(path.join("/"));
  if (rel.startsWith("..") || rel.includes("\0")) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
  const full = join(UPLOAD_ROOT, "recipes", rel);
  try {
    await stat(full);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = await readFile(full);
  const mime = guessMime(rel);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": mime,
      // Filenames are UUIDs → content never changes. Cache aggressively.
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}

function guessMime(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
