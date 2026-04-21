import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

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
