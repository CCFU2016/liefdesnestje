import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eventDocuments, holidays } from "@/lib/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_DOC_BYTES, saveUpload } from "@/lib/uploads";
import { sniffMime } from "@/lib/file-magic";

export const maxDuration = 30;

const ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;
type AllowedMime = (typeof ALLOWED_MIMES)[number];

function extFor(mime: AllowedMime): string {
  return mime === "application/pdf"
    ? "pdf"
    : mime === "image/png"
      ? "png"
      : mime === "image/gif"
        ? "gif"
        : mime === "image/webp"
          ? "webp"
          : "jpg";
}

async function loadForCaller(
  id: string,
  ctx: Awaited<ReturnType<typeof requireHouseholdMember>>
) {
  const h = (await db.select().from(holidays).where(eq(holidays.id, id)).limit(1))[0];
  if (!h || h.householdId !== ctx.householdId || h.deletedAt) return null;
  if (h.visibility === "private" && h.authorId !== ctx.userId) return null;
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db
      .select({
        id: eventDocuments.id,
        filename: eventDocuments.filename,
        mimeType: eventDocuments.mimeType,
        sizeBytes: eventDocuments.sizeBytes,
        createdAt: eventDocuments.createdAt,
        uploadedBy: eventDocuments.uploadedBy,
      })
      .from(eventDocuments)
      .where(and(eq(eventDocuments.holidayId, id), isNull(eventDocuments.deletedAt)))
      .orderBy(asc(eventDocuments.createdAt));
    return NextResponse.json({ documents: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_DOC_BYTES) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 413 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffMime(bytes);
    if (!sniffed || !ALLOWED_MIMES.includes(sniffed as AllowedMime)) {
      return NextResponse.json(
        { error: "Supported types: PDF, JPEG, PNG, GIF, WebP" },
        { status: 400 }
      );
    }
    const mime = sniffed as AllowedMime;

    // Preserve the user's original filename (sanitized) when possible so
    // the list is recognisable. Fall back to a generated name.
    const rawName = (file.name || "").trim();
    const base = rawName
      ? rawName.replace(/[/\\]/g, "_").replace(/\.\./g, "_").slice(0, 120)
      : `document-${Date.now()}.${extFor(mime)}`;

    const { relPath } = await saveUpload({
      subdir: `holidays/${id}/docs`,
      // Prepend a short random id so two uploads with the same filename
      // coexist on disk.
      filename: `${crypto.randomUUID().slice(0, 8)}-${base}`,
      bytes,
      mime,
    });

    const [created] = await db
      .insert(eventDocuments)
      .values({
        householdId: ctx.householdId,
        holidayId: id,
        uploadedBy: ctx.userId,
        filename: rawName || `document.${extFor(mime)}`,
        localPath: relPath,
        mimeType: mime,
        sizeBytes: file.size,
      })
      .returning();

    return NextResponse.json({ document: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("event document upload failed", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
