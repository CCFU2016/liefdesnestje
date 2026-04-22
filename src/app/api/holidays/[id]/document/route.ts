import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { DOC_MIME_TYPES, MAX_DOC_BYTES, UPLOAD_ROOT, saveUpload } from "@/lib/uploads";
import { sniffMime } from "@/lib/file-magic";

export const maxDuration = 60;

async function loadForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const h = (await db.select().from(holidays).where(eq(holidays.id, id)).limit(1))[0];
  if (!h || h.householdId !== ctx.householdId || h.deletedAt) return null;
  if (h.visibility === "private" && h.authorId !== ctx.userId) return null;
  return h;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (h.authorId !== ctx.userId) {
      return NextResponse.json({ error: "Only the author can upload." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_DOC_BYTES) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 413 });
    }
    if (!DOC_MIME_TYPES.includes(file.type as (typeof DOC_MIME_TYPES)[number])) {
      return NextResponse.json(
        { error: "Supported types: PDF, JPEG, PNG, WebP" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Magic-byte verification — don't trust the client MIME header.
    const sniffed = sniffMime(bytes);
    if (!sniffed || !DOC_MIME_TYPES.includes(sniffed as (typeof DOC_MIME_TYPES)[number])) {
      return NextResponse.json(
        { error: "File doesn't look like a real PDF/JPEG/PNG/WebP." },
        { status: 400 }
      );
    }
    const safeName = file.name.replace(/[/\\..]/g, "_").slice(0, 120) || `document`;
    await saveUpload({
      subdir: `holidays/${id}`,
      filename: safeName,
      bytes,
      mime: sniffed,
    });

    const docUrl = `/api/holidays/${id}/document?name=${encodeURIComponent(safeName)}`;
    await db.update(holidays).set({ documentUrl: docUrl, updatedAt: new Date() }).where(eq(holidays.id, id));
    return NextResponse.json({ documentUrl: docUrl });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadForCaller(id, ctx);
    if (!h || !h.documentUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const rel = normalize(name);
    if (rel.startsWith("..") || rel.includes("/") || rel.includes("\0")) {
      return NextResponse.json({ error: "Bad path" }, { status: 400 });
    }
    const full = join(UPLOAD_ROOT, "holidays", id, rel);
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
        "content-disposition": `inline; filename="${rel}"`,
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
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
