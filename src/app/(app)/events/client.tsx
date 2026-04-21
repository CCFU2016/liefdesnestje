"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { Calendar, CalendarCheck, Plus, AlertCircle, Tag } from "lucide-react";
import { differenceInCalendarDays, format, isBefore } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Dialog from "@radix-ui/react-dialog";

type Member = { userId: string; displayName: string; color: string };

type Category = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

type Event = {
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function EventsClient({
  initialEvents,
  members,
  currentUserId,
  connectedProviders,
  categories: initialCategories,
}: {
  initialEvents: Event[];
  members: Member[];
  currentUserId: string;
  connectedProviders: Array<"google" | "microsoft">;
  categories: Category[];
}) {
  const [dialog, setDialog] = useState<{ existing?: Event } | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<string | null | "uncategorized">(null);

  const { data, mutate } = useSWR<{ holidays: Event[] }>(`/api/holidays`, fetcher, {
    fallbackData: { holidays: initialEvents },
    refreshInterval: 10000,
  });
  const items = data?.holidays ?? initialEvents;

  const { data: catData, mutate: mutateCategories } = useSWR<{ categories: Category[] }>(
    `/api/event-categories`,
    fetcher,
    { fallbackData: { categories: initialCategories } }
  );
  const categories = catData?.categories ?? initialCategories;
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filtered = useMemo(() => {
    if (filterCategoryId === null) return items;
    if (filterCategoryId === "uncategorized") return items.filter((e) => !e.categoryId);
    return items.filter((e) => e.categoryId === filterCategoryId);
  }, [items, filterCategoryId]);

  const { upcoming, past } = useMemo(() => {
    const up: Event[] = [];
    const pa: Event[] = [];
    for (const h of filtered) {
      if (isBefore(parseYmd(h.startsOn), today)) pa.push(h);
      else up.push(h);
    }
    return { upcoming: up, past: pa.reverse() };
  }, [filtered, today]);

  const memberByUserId = new Map(members.map((m) => [m.userId, m]));

  const uncatCount = items.filter((e) => !e.categoryId).length;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button onClick={() => setDialog({})}>
          <Plus className="h-4 w-4" /> New event
        </Button>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <FilterChip
            active={filterCategoryId === null}
            onClick={() => setFilterCategoryId(null)}
          >
            All ({items.length})
          </FilterChip>
          {categories.map((c) => {
            const count = items.filter((e) => e.categoryId === c.id).length;
            return (
              <FilterChip
                key={c.id}
                active={filterCategoryId === c.id}
                color={c.color ?? undefined}
                onClick={() => setFilterCategoryId(c.id)}
              >
                {c.name} ({count})
              </FilterChip>
            );
          })}
          {uncatCount > 0 && (
            <FilterChip
              active={filterCategoryId === "uncategorized"}
              onClick={() => setFilterCategoryId("uncategorized")}
            >
              uncategorized ({uncatCount})
            </FilterChip>
          )}
          <Link
            href="/settings#categories"
            className="text-xs px-2 py-0.5 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 flex items-center gap-1"
          >
            <Tag className="h-3 w-3" /> manage
          </Link>
        </div>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">
          {filterCategoryId
            ? "No events in this category."
            : "No events planned yet. Add your next trip, milestone, or day off."}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">Upcoming</h2>
          {upcoming.map((h) => (
            <EventCard
              key={h.id}
              event={h}
              memberByUserId={memberByUserId}
              category={h.categoryId ? categoryById.get(h.categoryId) : undefined}
              canEdit={h.authorId === currentUserId}
              onEdit={() => setDialog({ existing: h })}
            />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <details className="mt-8">
          <summary className="text-xs uppercase tracking-wider text-zinc-500 cursor-pointer hover:text-zinc-700">
            Previous ({past.length})
          </summary>
          <div className="mt-3 space-y-3 opacity-60">
            {past.map((h) => (
              <EventCard
                key={h.id}
                event={h}
                memberByUserId={memberByUserId}
                category={h.categoryId ? categoryById.get(h.categoryId) : undefined}
                canEdit={h.authorId === currentUserId}
                onEdit={() => setDialog({ existing: h })}
              />
            ))}
          </div>
        </details>
      )}

      {dialog && (
        <EventDialog
          existing={dialog.existing}
          members={members}
          categories={categories}
          connectedProviders={connectedProviders}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            mutate();
            mutateCategories();
          }}
          onCategoryCreated={() => mutateCategories()}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
        active
          ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50"
          : "bg-transparent text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
      }`}
    >
      {color && (
        <span
          className="inline-block h-2 w-2 rounded-full mr-1 align-middle"
          style={{ background: color }}
        />
      )}
      {children}
    </button>
  );
}

function EventCard({
  event,
  memberByUserId,
  category,
  canEdit,
  onEdit,
}: {
  event: Event;
  memberByUserId: Map<string, Member>;
  category?: Category;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const start = parseYmd(event.startsOn);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysAway = differenceInCalendarDays(start, now);
  const isPast = daysAway < 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/events/${event.id}`} className="font-semibold truncate hover:underline">
                {event.title}
              </Link>
              {category && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1"
                  style={{
                    background: category.color
                      ? `${category.color}22` // 13% alpha
                      : "rgb(244 244 245)",
                    color: category.color ?? "inherit",
                  }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: category.color ?? "currentColor" }}
                  />
                  {category.name}
                </span>
              )}
              {event.pushToCalendar && event.externalCalendarEventId && (
                <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
              )}
              {event.pushToCalendar && !event.externalCalendarEventId && (
                <span title="Push pending or failed">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                </span>
              )}
              {event.visibility === "private" && (
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">private</span>
              )}
            </div>
            <div className="text-sm text-zinc-500 mt-0.5">
              {format(start, "d MMM yyyy")}
              {event.endsOn && ` – ${format(parseYmd(event.endsOn), "d MMM yyyy")}`}
            </div>
            {event.forPersons.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {event.forPersons.map((uid) => {
                  const m = memberByUserId.get(uid);
                  if (!m) return null;
                  return (
                    <span key={uid} className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: m.color }}
                      />
                      {m.displayName}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold">{Math.abs(daysAway)}</div>
            <div className="text-xs text-zinc-500">{isPast ? "days ago" : "days away"}</div>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={onEdit} className="mt-1 h-7 px-2 text-xs">
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EventDialog({
  existing,
  members,
  categories,
  connectedProviders,
  onClose,
  onSaved,
  onCategoryCreated,
}: {
  existing?: Event;
  members: Member[];
  categories: Category[];
  connectedProviders: Array<"google" | "microsoft">;
  onClose: () => void;
  onSaved: () => void;
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
      onSaved();
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
