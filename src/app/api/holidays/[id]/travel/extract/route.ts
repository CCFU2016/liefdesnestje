import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { holidays } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  extractReservation,
} from "@/lib/claude";
import { MAX_DOC_BYTES, saveUpload } from "@/lib/uploads";
import { sniffMime } from "@/lib/file-magic";

export const maxDuration = 60;

const ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

type AllowedMime = (typeof ALLOWED_MIMES)[number];

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

    // Persist the document alongside other travel files for this event so
    // the user can re-open it from the reservation later. We save into a
    // subdir keyed by the holiday so they stay organized.
    const safeName =
      (file.name || "reservation").replace(/[/\\..]/g, "_").slice(0, 120) ||
      `reservation.${extFor(mime)}`;
    const { relPath } = await saveUpload({
      subdir: `holidays/${id}/travel`,
      filename: safeName,
      bytes,
      mime,
    });
    // We reuse the existing holidays document GET pattern: served from
    // /api/holidays/[id]/document?name=... — but that expects the file at
    // UPLOAD_ROOT/holidays/<id>/<name>. Our subdir adds /travel/, so we
    // expose a direct app-served URL via /api/uploads for now.
    //
    // NB: `/api/uploads/recipes/*` is the existing serve route; we mirror
    // it via a shared travel-docs endpoint below so this URL resolves.
    const documentUrl = `/api/holidays/${id}/travel/document?path=${encodeURIComponent(
      relPath.split("/").slice(1).join("/") // drop top-level "holidays/<id>"
    )}`;

    const base64 = Buffer.from(bytes).toString("base64");
    const extracted = await extractReservation({
      mediaType: mime,
      base64,
      hintText: h.title ? `This belongs to the event "${h.title}".` : undefined,
      userId: ctx.userId,
    });

    return NextResponse.json({ extracted, documentUrl });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof ClaudeNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    if (e instanceof ExtractionBudgetError) {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    console.error("extract reservation failed", e);
    return NextResponse.json(
      { error: "Couldn't read that file — you can still fill the form manually." },
      { status: 500 }
    );
  }
}

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
