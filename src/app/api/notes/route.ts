import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { and, eq, isNull, or, desc, sql } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();

    const base = and(
      eq(notes.householdId, ctx.householdId),
      isNull(notes.deletedAt),
      or(eq(notes.visibility, "shared"), eq(notes.authorId, ctx.userId))
    );

    if (q) {
      // plainto_tsquery handles free-form input, including single words
      const rows = await db
        .select({
          id: notes.id,
          title: notes.title,
          pinned: notes.pinned,
          visibility: notes.visibility,
          updatedAt: notes.updatedAt,
          authorId: notes.authorId,
        })
        .from(notes)
        .where(
          and(
            base,
            or(
              sql`to_tsvector('simple', ${notes.contentText}) @@ plainto_tsquery('simple', ${q})`,
              sql`${notes.title} ILIKE ${`%${q}%`}`
            )
          )
        )
        .orderBy(desc(notes.pinned), desc(notes.updatedAt))
        .limit(50);
      return NextResponse.json({ notes: rows });
    }

    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        pinned: notes.pinned,
        visibility: notes.visibility,
        updatedAt: notes.updatedAt,
        authorId: notes.authorId,
      })
      .from(notes)
      .where(base)
      .orderBy(desc(notes.pinned), desc(notes.updatedAt))
      .limit(100);
    return NextResponse.json({ notes: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const ctx = await requireHouseholdMember();
    const [created] = await db
      .insert(notes)
      .values({
        householdId: ctx.householdId,
        authorId: ctx.userId,
        title: "Untitled",
        contentJson: { type: "doc", content: [{ type: "paragraph" }] },
        contentText: "",
        visibility: "shared",
      })
      .returning();
    return NextResponse.json({ id: created.id });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
