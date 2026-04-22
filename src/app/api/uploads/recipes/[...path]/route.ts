import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { UPLOAD_ROOT } from "@/lib/uploads";
import { getCachedUserId } from "@/lib/auth/session-cache";

// Auth-gated serve for recipe images. Filenames are random UUIDs so URLs
// are already unguessable, but we still require a signed-in caller so a
// leaked URL can't be hotlinked outside the app.
//
// Uses a 60s in-memory session cache to avoid slamming the DB — a recipe
// grid loads 20+ images in parallel and a cold session lookup per image
// saturated the connection pool in earlier versions.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const userId = await getCachedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { path } = await params;
  const rel = normalize(path.join("/"));
  if (rel.startsWith("..") || rel.includes("\0")) {
    return NextResponse.json({ error: "Bad path" }, { status: 400 });
  }
  const full = join(UPLOAD_ROOT, "recipes", rel);
  try {
    const st = await stat(full);
    if (!st.isFile()) {
      console.warn(`[uploads] not a file: ${full}`);
      return NextResponse.json({ error: "Not a file" }, { status: 404 });
    }
  } catch (e) {
    // Log the resolved path + UPLOAD_ROOT so Railway logs show whether
    // the Volume mount / env is set up correctly.
    console.warn(
      `[uploads] miss: ${full} (UPLOAD_ROOT=${UPLOAD_ROOT}, rel=${rel}, err=${
        e instanceof Error ? e.message : String(e)
      })`
    );
    return NextResponse.json(
      { error: "Not found", path: full, uploadRoot: UPLOAD_ROOT },
      { status: 404 }
    );
  }
  const bytes = await readFile(full);
  const mime = guessMime(rel);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": mime,
      // Filenames are UUIDs → content never changes. Cache in the private
      // browser cache only (auth-gated, don't let shared caches keep a copy).
      "cache-control": "private, max-age=604800, immutable",
    },
  });
}

function guessMime(p: string): string {
  const lower = p.toLowerCase();
  // Accept either ".jpg" or "_jpg" at end. Earlier versions had a buggy
  // filename sanitizer that turned the extension dot into an underscore,
  // so some files on the Volume are named abc_jpg instead of abc.jpg —
  // still perfectly valid JPEG bytes, just misnamed.
  if (/[._](jpe?g)$/.test(lower)) return "image/jpeg";
  if (/[._]png$/.test(lower)) return "image/png";
  if (/[._]gif$/.test(lower)) return "image/gif";
  if (/[._]webp$/.test(lower)) return "image/webp";
  if (/[._]pdf$/.test(lower)) return "application/pdf";
  return "application/octet-stream";
}
