import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { notes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireHouseholdMember();
  const note = (await db.select().from(notes).where(eq(notes.id, id)).limit(1))[0];
  if (!note || note.householdId !== ctx.householdId || note.deletedAt) notFound();
  if (note.visibility === "private" && note.authorId !== ctx.userId) notFound();

  return (
    <NoteEditor
      note={{
        id: note.id,
        title: note.title,
        contentJson: note.contentJson as Record<string, unknown>,
        pinned: note.pinned,
        visibility: note.visibility,
      }}
      canEditVisibility={note.authorId === ctx.userId}
    />
  );
}
