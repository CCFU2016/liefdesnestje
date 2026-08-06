"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Dialog from "@radix-ui/react-dialog";

export type Member = { userId: string; displayName: string; color: string };

export type Category = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

export type Event = {
  id: string;
  title: string;
  description: string | null;
  startsOn: string;
  endsOn: string | null;
  forPersons: string[];
  categoryId: string | null;
  pushToCalendar: boolean;
  externalCalendarEventId: string | null;
  externalCalendarProvider: "google" | "microsoft" | null;
  visibility: "private" | "shared";
  authorId: string;
  documentUrl: string | null;
};

export function EventDialog({
  existing,
  members,
  categories,
  connectedProviders,
  onClose,
  onSaved,
  onDeleted,
  onCategoryCreated,
}: {
  existing?: Event;
  members: Member[];
  categories: Category[];
  connectedProviders: Array<"google" | "microsoft">;
  onClose: () => void;
  onSaved: () => void;
  /** After a delete. Defaults to onSaved — pass this from pages that can't
      re-render the deleted event (e.g. its own detail page). */
  onDeleted?: () => void;
  onCategoryCreated: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? today());
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [forPersons, setForPersons] = useState<Set<string>>(
    new Set(existing?.forPersons ?? members.map((m) => m.userId))
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    existing?.categoryId ?? categories[0]?.id ?? null
  );
  const [pushToCalendar, setPushToCalendar] = useState(existing?.pushToCalendar ?? false);
  const [pushProvider, setPushProvider] = useState<"google" | "microsoft">(
    existing?.externalCalendarProvider ?? connectedProviders[0] ?? "google"
  );
  const [isPrivate, setIsPrivate] = useState(existing?.visibility === "private");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const togglePerson = (uid: string) => {
    const next = new Set(forPersons);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setForPersons(next);
  };

  const createCategory = async () => {
    const name = newCategoryName.trim().toLowerCase();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/event-categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      const { category } = await res.json();
      onCategoryCreated();
      setCategoryId(category.id);
      setNewCategoryName("");
      setAddingCategory(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!title.trim()) return toast.error("A title is required.");
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        startsOn,
        endsOn: endsOn || null,
        forPersons: Array.from(forPersons),
        categoryId,
        pushToCalendar,
        pushProvider: pushToCalendar ? pushProvider : null,
        visibility: isPrivate ? "private" : "shared",
      };
      const res = existing
        ? await fetch(`/api/holidays/${existing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/holidays", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      const body = await res.json();
      const eventId = body.holiday.id;

      if (body.warning) toast.message(body.warning);

      if (docFile) {
        const fd = new FormData();
        fd.append("file", docFile);
        const up = await fetch(`/api/holidays/${eventId}/document`, { method: "POST", body: fd });
        if (!up.ok) toast.error("Event saved, but the document upload failed.");
      }

      toast.success(existing ? "Saved" : "Event added");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm(`Delete "${existing.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/holidays/${existing.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      (onDeleted ?? onSaved)();
    } catch {
      toast.error("Delete failed");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">
            {existing ? "Edit event" : "New event"}
          </Dialog.Title>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Ski trip to Austria"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Starts</Label>
                <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Ends (optional)</Label>
                <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              {addingCategory ? (
                <div className="flex gap-2">
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="New category name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createCategory();
                    }}
                    autoFocus
                  />
                  <Button size="sm" onClick={createCategory} disabled={busy}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingCategory(false);
                      setNewCategoryName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    className="flex-1 h-9 rounded-md border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-800"
                    value={categoryId ?? ""}
                    onChange={(e) => setCategoryId(e.target.value || null)}
                  >
                    <option value="">— uncategorized —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => setAddingCategory(true)}>
                    + new
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>For</Label>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <label key={m.userId} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forPersons.has(m.userId)}
                      onChange={() => togglePerson(m.userId)}
                    />
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: m.color }}
                    />
                    {m.displayName}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desc">Notes</Label>
              <textarea
                id="desc"
                className="w-full min-h-[80px] rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Document (PDF or image, max 10MB)</Label>
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
              />
              {existing?.documentUrl && !docFile && (
                <a
                  href={existing.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-500 underline"
                >
                  Current document
                </a>
              )}
            </div>

            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pushToCalendar}
                  onChange={(e) => setPushToCalendar(e.target.checked)}
                  disabled={connectedProviders.length === 0}
                />
                <Calendar className="h-4 w-4" />
                Add to my calendar
              </label>
              {connectedProviders.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Connect a calendar in{" "}
                  <Link href="/settings" className="underline">
                    Settings
                  </Link>{" "}
                  to enable.
                </p>
              ) : connectedProviders.length > 1 && pushToCalendar ? (
                <select
                  className="w-full h-9 rounded-md border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-800"
                  value={pushProvider}
                  onChange={(e) => setPushProvider(e.target.value as "google" | "microsoft")}
                >
                  <option value="google">Google Calendar</option>
                  <option value="microsoft">Microsoft Calendar</option>
                </select>
              ) : pushToCalendar ? (
                <p className="text-xs text-zinc-500">
                  Will push to your {connectedProviders[0] === "google" ? "Google" : "Microsoft"} calendar.
                </p>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              Private (only visible to you)
            </label>
          </div>

          <div className="mt-6 flex justify-between">
            <div>
              {existing && (
                <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Saving…" : existing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
