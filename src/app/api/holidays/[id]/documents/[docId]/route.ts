import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { eventDocuments, holidays } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { UPLOAD_ROOT } from "@/lib/uploads";

async function loadForCaller(
  id: string,
  docId: string,
  ctx: Awaited<ReturnType<typeof requireHouseholdMember>>
) {
  const h = (await db.select().from(holidays).where(eq(holidays.id, id)).limit(1))[0];
  if (!h || h.householdId !== ctx.householdId || h.deletedAt) return null;
  if (h.visibility === "private" && h.authorId !== ctx.userId) return null;
  const d = (
    await db
      .select()
      .from(eventDocuments)
      .where(
        and(
          eq(eventDocuments.id, docId),
          eq(eventDocuments.holidayId, id),
          isNull(eventDocuments.deletedAt)
        )
      )
      .limit(1)
  )[0];
  if (!d) return null;
  return { holiday: h, doc: d };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const ctx = await requireHouseholdMember();
    const { id, docId } = await params;
    const loaded = await loadForCaller(id, docId, ctx);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { doc } = loaded;
    const full = join(UPLOAD_ROOT, doc.localPath);
    try {
      const st = await stat(full);
      if (!st.isFile()) return NextResponse.json({ error: "not a file" }, { status: 404 });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const bytes = await readFile(full);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.mimeType,
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const ctx = await requireHouseholdMember();
    const { id, docId } = await params;
    const loaded = await loadForCaller(id, docId, ctx);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Anyone with access to the event can remove attachments — keeps the
    // UX symmetric with upload. Bytes stay on disk; only the DB row is
    // soft-deleted (the serve route requires a live row).
    await db
      .update(eventDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(eventDocuments.id, docId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
