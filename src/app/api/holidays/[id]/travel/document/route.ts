import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Auth-gated serve for per-event travel docs (PDFs / reservation screenshots).
// Same household-scoped access check as the rest of the holiday routes.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;

    const h = (await db.select().from(holidays).where(eq(holidays.id, id)).limit(1))[0];
    if (!h || h.householdId !== ctx.householdId || h.deletedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (h.visibility === "private" && h.authorId !== ctx.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) return NextResponse.json({ error: "missing path" }, { status: 400 });

    // Guard path traversal — the `path` is expected to be travel/<filename>.
    const rel = normalize(path);
    if (rel.startsWith("..") || rel.includes("\0")) {
      return NextResponse.json({ error: "bad path" }, { status: 400 });
    }
    if (!rel.startsWith("travel/")) {
      return NextResponse.json({ error: "bad path" }, { status: 400 });
    }

    const full = join(UPLOAD_ROOT, "holidays", id, rel);
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
        "cache-control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function guessMime(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(jpe?g)$/.test(lower)) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
