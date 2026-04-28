import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Auth-gated avatar serve. Path is supplied by the client but constrained
// to avatars/<uuid>/... below UPLOAD_ROOT so traversal is impossible.
export async function GET(req: Request) {
  try {
    await requireHouseholdMember();
    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });
    const rel = normalize(path);
    if (rel.startsWith("..") || rel.includes("\0") || !rel.startsWith("avatars/")) {
      return NextResponse.json({ error: "bad path" }, { status: 400 });
    }
    const full = join(UPLOAD_ROOT, rel);
    try {
      const st = await stat(full);
      if (!st.isFile()) return NextResponse.json({ error: "not a file" }, { status: 404 });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const bytes = await readFile(full);
    const mime = guessMime(rel);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": mime,
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function guessMime(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
