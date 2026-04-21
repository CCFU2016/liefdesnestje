"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pin, Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type NoteListItem = {
  id: string;
  title: string;
  pinned: boolean;
  visibility: "private" | "shared";
  updatedAt: Date | string;
  authorId: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function NotesPage({
  initialNotes,
  currentUserId: _currentUserId,
}: {
  initialNotes: NoteListItem[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const { data, mutate } = useSWR<{ notes: NoteListItem[] }>(
    query ? `/api/notes?q=${encodeURIComponent(query)}` : `/api/notes`,
    fetcher,
    { fallbackData: { notes: initialNotes }, refreshInterval: 10000 }
  );
  const notes = data?.notes ?? initialNotes;
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);

  const createNote = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/notes", { method: "POST" });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      router.push(`/notes/${id}`);
      router.refresh();
    } catch {
      toast.error("Could not create note.");
      setCreating(false);
    }
  };

  const togglePin = async (note: NoteListItem) => {
    mutate(
      (prev) => ({
        notes: (prev?.notes ?? []).map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)),
      }),
      false
    );
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    mutate();
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-semibold">Notes</h1>
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              className="pl-8"
            />
          </div>
          <Button onClick={createNote} disabled={creating}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-zinc-500">
            {query ? "Nothing matches that." : "No notes yet. Create your first one."}
          </CardContent>
        </Card>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Pinned</h2>
              <NoteGrid notes={pinned} onTogglePin={togglePin} />
            </section>
          )}
          {rest.length > 0 && (
            <section>
              {pinned.length > 0 && (
                <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">All notes</h2>
              )}
              <NoteGrid notes={rest} onTogglePin={togglePin} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function NoteGrid({
  notes,
  onTogglePin,
}: {
  notes: NoteListItem[];
  onTogglePin: (n: NoteListItem) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {notes.map((n) => (
        <li key={n.id} className="relative group">
          <a
            href={`/notes/${n.id}`}
            className="block rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
          >
            <div className="font-medium pr-6 truncate">{n.title || "Untitled"}</div>
            <div className="text-xs text-zinc-500 mt-1">
              {format(new Date(n.updatedAt), "d MMM HH:mm")}
              {n.visibility === "private" ? " · private" : ""}
            </div>
          </a>
          <button
            onClick={(e) => {
              e.preventDefault();
              onTogglePin(n);
            }}
            className={`absolute right-2 top-2 p-1.5 rounded transition-opacity ${
              n.pinned
                ? "opacity-100 text-amber-500"
                : "opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
            aria-label={n.pinned ? "Unpin" : "Pin"}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
