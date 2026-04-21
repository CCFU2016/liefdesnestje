import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Authed static-file serve for recipe images.
// Any household member can view any recipe image (recipes are household-scoped).
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    await requireHouseholdMember();
    const { path } = await params;
    const rel = normalize(path.join("/"));
    // Reject traversal attempts
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
        "cache-control": "private, max-age=300",
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
