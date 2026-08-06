import { requireHouseholdMember, visibleToFilter } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { NotesPage } from "@/components/notes/notes-page";

export default async function Notes() {
  const ctx = await requireHouseholdMember();
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
        eq(notes.householdId, ctx.householdId),
        isNull(notes.deletedAt),
        visibleToFilter(ctx, notes)
      )
    )
    .orderBy(desc(notes.pinned), desc(notes.updatedAt));

  return <NotesPage initialNotes={rows} currentUserId={ctx.userId} />;
}
