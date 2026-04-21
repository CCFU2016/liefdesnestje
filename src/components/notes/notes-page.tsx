"use client";

// Placeholder — full Tiptap editor in Sprint 4.
// TODO(liefdesnestje): rich editor with autosave, FTS, pinned, visibility.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

type NoteListItem = {
  id: string;
  title: string;
  pinned: boolean;
  visibility: "private" | "shared";
  updatedAt: Date;
  authorId: string;
};

export function NotesPage({
  initialNotes,
  currentUserId: _currentUserId,
}: {
  initialNotes: NoteListItem[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const createNote = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/notes", { method: "POST" });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      router.push(`/notes/${id}`);
      router.refresh();
    } catch {
      toast.error("Could not create note. Try again.");
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Notes</h1>
        <Button onClick={createNote} disabled={creating}>New note</Button>
      </div>
      {initialNotes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-zinc-500">
            No notes yet. Create your first one.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {initialNotes.map((n) => (
            <li key={n.id}>
              <a
                href={`/notes/${n.id}`}
                className="block rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-baseline justify-between">
                  <div className="font-medium">{n.title || "Untitled"}</div>
                  {n.pinned && <span className="text-xs text-zinc-500">Pinned</span>}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {format(n.updatedAt, "d MMM HH:mm")}
                  {n.visibility === "private" ? " · private" : ""}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
