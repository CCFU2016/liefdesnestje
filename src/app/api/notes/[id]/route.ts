import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  contentJson: z.unknown().optional(),
  contentText: z.string().optional(),
  pinned: z.boolean().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
});

async function getNoteForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const n = (await db.select().from(notes).where(eq(notes.id, id)).limit(1))[0];
  if (!n) return null;
  if (n.householdId !== ctx.householdId) return null;
  if (n.visibility === "private" && n.authorId !== ctx.userId) return null;
  if (n.deletedAt) return null;
  return n;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const note = await getNoteForCaller(id, ctx);
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ note });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const current = await getNoteForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const update: Partial<typeof notes.$inferInsert> = { updatedAt: new Date() };
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.contentJson !== undefined) update.contentJson = body.data.contentJson;
    if (body.data.contentText !== undefined) update.contentText = body.data.contentText;
    if (body.data.pinned !== undefined) update.pinned = body.data.pinned;
    if (body.data.visibility !== undefined) update.visibility = body.data.visibility;

    const [updated] = await db.update(notes).set(update).where(eq(notes.id, id)).returning();
    return NextResponse.json({ note: updated });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const current = await getNoteForCaller(id, ctx);
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
