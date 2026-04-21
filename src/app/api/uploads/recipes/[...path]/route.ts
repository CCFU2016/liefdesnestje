import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { auth } from "@/lib/auth/config";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Authed static-file serve for recipe images.
// Any signed-in household member can view recipe images — recipes are already
// household-scoped, and these URLs have random UUIDs so they're not guessable.
// Use a light session check (not requireHouseholdMember) to avoid an extra DB
// round-trip per image request — the list page can request 20+ images in
// parallel and the household-membership query was creating a connection-pool
// bottleneck.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

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
      "cache-control": "private, max-age=604800, immutable",
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
