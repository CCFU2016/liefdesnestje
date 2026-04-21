"use client";

// Placeholder — fully built in Sprint 3 with dnd-kit + RRULE + cmd+k.
// TODO(liefdesnestje): lists sidebar, drag-reorder, recurrence picker, assignees.

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TodoList = { id: string; name: string };
type Member = { userId: string; displayName: string; color: string };
type Todo = {
  id: string;
  title: string;
  completedAt: Date | null;
  listId: string;
  authorId: string;
  assigneeId: string | null;
  dueAt: Date | null;
  visibility: "private" | "shared";
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TodosPage({
  initialLists,
  members,
  currentUserId,
}: {
  initialLists: TodoList[];
  members: Member[];
  currentUserId: string;
}) {
  const [activeListId, setActiveListId] = useState(initialLists[0]?.id);
  const { data, mutate } = useSWR<{ todos: Todo[] }>(
    activeListId ? `/api/todos?listId=${activeListId}` : null,
    fetcher,
    { refreshInterval: 5000 }
  );
  const [newTitle, setNewTitle] = useState("");

  const addTodo = async () => {
    if (!activeListId || !newTitle.trim()) return;
    const title = newTitle.trim();
    setNewTitle("");
    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId: activeListId, title }),
      });
      mutate();
    } catch {
      toast.error("Could not add. Try again.");
    }
  };

  const toggle = async (todo: Todo) => {
    // Optimistic
    mutate(
      (prev) => ({
        todos: (prev?.todos ?? []).map((t) =>
          t.id === todo.id ? { ...t, completedAt: todo.completedAt ? null : new Date() } : t
        ),
      }),
      false
    );
    await fetch(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: !todo.completedAt }),
    });
    mutate();
  };

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="flex gap-6">
        <aside className="hidden md:block w-48 shrink-0">
          <h3 className="text-sm font-semibold mb-2">Lists</h3>
          <ul className="space-y-1">
            {initialLists.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => setActiveListId(l.id)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm ${
                    activeListId === l.id
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  {l.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="flex-1">
          <Card>
            <CardHeader>
              <CardTitle>{initialLists.find((l) => l.id === activeListId)?.name ?? "To-dos"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addTodo();
                }}
                className="flex gap-2"
              >
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Add a to-do…"
                />
                <Button type="submit">Add</Button>
              </form>
              <ul className="space-y-1">
                {(data?.todos ?? []).map((t) => {
                  const assignee = members.find((m) => m.userId === t.assigneeId);
                  return (
                    <li key={t.id} className="flex items-start gap-3 py-1">
                      <input
                        type="checkbox"
                        checked={!!t.completedAt}
                        onChange={() => toggle(t)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div
                          className={`text-sm ${
                            t.completedAt ? "line-through text-zinc-400" : ""
                          }`}
                        >
                          {t.title}
                        </div>
                        {assignee && (
                          <div className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: assignee.color }}
                            />
                            {assignee.displayName}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
                {data && data.todos.length === 0 && (
                  <li className="text-sm text-zinc-500 py-4">Nothing here yet.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
