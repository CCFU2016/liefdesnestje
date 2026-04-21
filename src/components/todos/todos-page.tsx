"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RecurrencePicker, describeRRule } from "./recurrence-picker";
import { CommandBar } from "./command-bar";

type List = { id: string; name: string };
type Member = { userId: string; displayName: string; color: string };
type Todo = {
  id: string;
  title: string;
  notes: string | null;
  completedAt: Date | string | null;
  listId: string;
  authorId: string;
  assigneeId: string | null;
  dueAt: Date | string | null;
  recurrenceRule: string | null;
  visibility: "private" | "shared";
  sortOrder: number;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TodosPage({
  initialLists,
  members,
  currentUserId,
}: {
  initialLists: List[];
  members: Member[];
  currentUserId: string;
}) {
  const [lists, setLists] = useState(initialLists);
  const [activeListId, setActiveListId] = useState(initialLists[0]?.id);
  const [newListName, setNewListName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [dueAt, setDueAt] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [rrule, setRRule] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);

  const { data, mutate } = useSWR<{ todos: Todo[] }>(
    activeListId ? `/api/todos?listId=${activeListId}` : null,
    fetcher,
    { refreshInterval: 5000, revalidateOnFocus: true }
  );
  const todos = (data?.todos ?? []).sort((a, b) => a.sortOrder - b.sortOrder);

  // Local optimistic reorder
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  useEffect(() => {
    setOrderedIds(todos.map((t) => t.id));
  }, [todos.map((t) => t.id).join(",")]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = orderedIds.indexOf(e.active.id as string);
    const newIdx = orderedIds.indexOf(e.over.id as string);
    const next = arrayMove(orderedIds, oldIdx, newIdx);
    setOrderedIds(next);
    // Persist new sortOrder per todo
    next.forEach((id, idx) => {
      fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sortOrder: idx }),
      });
    });
  };

  const addTodo = async () => {
    if (!activeListId || !newTitle.trim()) return;
    const title = newTitle.trim();
    const payload = {
      listId: activeListId,
      title,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      assigneeId: assigneeId || undefined,
      recurrenceRule: rrule || undefined,
      visibility: isPrivate ? "private" : "shared",
    };
    setNewTitle("");
    setDueAt("");
    setAssigneeId("");
    setRRule(null);
    setIsPrivate(false);
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      mutate();
    } catch {
      toast.error("Couldn't add. Try again.");
    }
  };

  const quickAdd = async (listId: string, title: string) => {
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId, title, visibility: "shared" }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Added to ${lists.find((l) => l.id === listId)?.name ?? "list"}`);
      if (listId === activeListId) mutate();
    } catch {
      toast.error("Couldn't add. Try again.");
    }
  };

  const toggle = async (todo: Todo) => {
    mutate(
      (prev) => ({
        todos: (prev?.todos ?? []).map((t) =>
          t.id === todo.id ? { ...t, completedAt: todo.completedAt ? null : new Date().toISOString() } : t
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

  const remove = async (id: string) => {
    if (!confirm("Delete this to-do?")) return;
    mutate(
      (prev) => ({ todos: (prev?.todos ?? []).filter((t) => t.id !== id) }),
      false
    );
    await fetch(`/api/todos/${id}`, { method: "DELETE" });
    mutate();
  };

  const addList = async () => {
    if (!newListName.trim()) return;
    try {
      const res = await fetch("/api/todo-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (!res.ok) throw new Error();
      const { list } = await res.json();
      setLists((prev) => [...prev, list]);
      setActiveListId(list.id);
      setNewListName("");
    } catch {
      toast.error("Couldn't create list.");
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <CommandBar lists={lists} onQuickAdd={quickAdd} />

      <div className="flex gap-6">
        <aside className="hidden md:block w-52 shrink-0">
          <h3 className="text-sm font-semibold mb-2">Lists</h3>
          <ul className="space-y-0.5">
            {lists.map((l) => (
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
          <div className="mt-3 flex gap-1">
            <Input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="New list"
              className="h-8 text-xs"
              onKeyDown={(e) => e.key === "Enter" && addList()}
            />
            <Button size="icon" variant="ghost" onClick={addList}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-wider text-zinc-500">⌘K for quick add</p>
        </aside>

        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{lists.find((l) => l.id === activeListId)?.name ?? "To-dos"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addTodo();
                }}
                className="space-y-2"
              >
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Add a to-do…"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    className="h-8 w-52"
                  />
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="h-8 rounded border border-zinc-200 bg-transparent px-2 dark:border-zinc-800"
                  >
                    <option value="">Anyone</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                  <RecurrencePicker value={rrule} onChange={setRRule} />
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                    />
                    Private
                  </label>
                  <Button type="submit" size="sm">Add</Button>
                </div>
              </form>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-1">
                    {orderedIds
                      .map((id) => todos.find((t) => t.id === id))
                      .filter((t): t is Todo => !!t)
                      .map((t) => (
                        <SortableTodo
                          key={t.id}
                          todo={t}
                          members={members}
                          currentUserId={currentUserId}
                          onToggle={() => toggle(t)}
                          onDelete={() => remove(t.id)}
                        />
                      ))}
                    {todos.length === 0 && (
                      <li className="text-sm text-zinc-500 py-6 text-center">All clear.</li>
                    )}
                  </ul>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SortableTodo({
  todo,
  members,
  currentUserId,
  onToggle,
  onDelete,
}: {
  todo: Todo;
  members: Member[];
  currentUserId: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const assignee = members.find((m) => m.userId === todo.assigneeId);
  const isMine = todo.authorId === currentUserId;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 group"
      {...attributes}
      {...listeners}
    >
      <input
        type="checkbox"
        checked={!!todo.completedAt}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${todo.completedAt ? "line-through text-zinc-400" : ""}`}>
          {todo.title}
          {todo.visibility === "private" && (
            <span className="ml-2 text-xs text-zinc-500">· private</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 mt-0.5">
          {todo.dueAt && <span>due {format(new Date(todo.dueAt), "d MMM HH:mm")}</span>}
          {todo.recurrenceRule && <span>· {describeRRule(todo.recurrenceRule)}</span>}
          {assignee && (
            <span className="flex items-center gap-1">
              · <span className="inline-block h-2 w-2 rounded-full" style={{ background: assignee.color }} />
              {assignee.displayName}
            </span>
          )}
          {!isMine && <span className="text-[10px] uppercase tracking-wider">shared</span>}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-500"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
