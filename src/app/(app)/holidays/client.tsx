"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { toast } from "sonner";
import { Calendar, CalendarCheck, Plus, AlertCircle } from "lucide-react";
import { addDays, differenceInCalendarDays, format, isBefore } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Dialog from "@radix-ui/react-dialog";

type Member = { userId: string; displayName: string; color: string };

type Holiday = {
  id: string;
  title: string;
  description: string | null;
  startsOn: string;
  endsOn: string | null;
  forPersons: string[];
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

export function HolidaysClient({
  initialHolidays,
  members,
  currentUserId,
  connectedProviders,
}: {
  initialHolidays: Holiday[];
  members: Member[];
  currentUserId: string;
  connectedProviders: Array<"google" | "microsoft">;
}) {
  const [dialog, setDialog] = useState<{ existing?: Holiday } | null>(null);

  const { data, mutate } = useSWR<{ holidays: Holiday[] }>(`/api/holidays`, fetcher, {
    fallbackData: { holidays: initialHolidays },
    refreshInterval: 10000,
  });
  const items = data?.holidays ?? initialHolidays;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { upcoming, past } = useMemo(() => {
    const up: Holiday[] = [];
    const pa: Holiday[] = [];
    for (const h of items) {
      if (isBefore(parseYmd(h.startsOn), today)) pa.push(h);
      else up.push(h);
    }
    return { upcoming: up, past: pa.reverse() };
  }, [items, today]);

  const memberByUserId = new Map(members.map((m) => [m.userId, m]));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Holidays</h1>
        <Button onClick={() => setDialog({})}>
          <Plus className="h-4 w-4" /> New holiday
        </Button>
      </div>

      {upcoming.length === 0 && past.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">
          No holidays planned yet. Add your next trip or a day off.
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">Upcoming</h2>
          {upcoming.map((h) => (
            <HolidayCard
              key={h.id}
              holiday={h}
              memberByUserId={memberByUserId}
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
              <HolidayCard
                key={h.id}
                holiday={h}
                memberByUserId={memberByUserId}
                canEdit={h.authorId === currentUserId}
                onEdit={() => setDialog({ existing: h })}
              />
            ))}
          </div>
        </details>
      )}

      {dialog && (
        <HolidayDialog
          existing={dialog.existing}
          members={members}
          connectedProviders={connectedProviders}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}

function HolidayCard({
  holiday,
  memberByUserId,
  canEdit,
  onEdit,
}: {
  holiday: Holiday;
  memberByUserId: Map<string, Member>;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const start = parseYmd(holiday.startsOn);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysAway = differenceInCalendarDays(start, now);
  const isPast = daysAway < 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/holidays/${holiday.id}`} className="font-semibold truncate hover:underline">
                {holiday.title}
              </Link>
              {holiday.pushToCalendar && holiday.externalCalendarEventId && (
                <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
              )}
              {holiday.pushToCalendar && !holiday.externalCalendarEventId && (
                <span title="Push pending or failed">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                </span>
              )}
              {holiday.visibility === "private" && (
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">private</span>
              )}
            </div>
            <div className="text-sm text-zinc-500 mt-0.5">
              {format(start, "d MMM yyyy")}
              {holiday.endsOn && ` – ${format(parseYmd(holiday.endsOn), "d MMM yyyy")}`}
            </div>
            {holiday.forPersons.length > 0 && (
              <div className="flex items-center gap-1 mt-1.5">
                {holiday.forPersons.map((uid) => {
                  const m = memberByUserId.get(uid);
                  if (!m) return null;
                  return (
                    <span
                      key={uid}
                      className="flex items-center gap-1 text-[11px] text-zinc-500"
                    >
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

function HolidayDialog({
  existing,
  members,
  connectedProviders,
  onClose,
  onSaved,
}: {
  existing?: Holiday;
  members: Member[];
  connectedProviders: Array<"google" | "microsoft">;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? today());
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [forPersons, setForPersons] = useState<Set<string>>(
    new Set(existing?.forPersons ?? members.map((m) => m.userId))
  );
  const [pushToCalendar, setPushToCalendar] = useState(existing?.pushToCalendar ?? false);
  const [pushProvider, setPushProvider] = useState<"google" | "microsoft">(
    existing?.externalCalendarProvider ?? connectedProviders[0] ?? "google"
  );
  const [isPrivate, setIsPrivate] = useState(existing?.visibility === "private");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const togglePerson = (uid: string) => {
    const next = new Set(forPersons);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setForPersons(next);
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
      const holidayId = body.holiday.id;

      if (body.warning) toast.message(body.warning);

      if (docFile) {
        const fd = new FormData();
        fd.append("file", docFile);
        const up = await fetch(`/api/holidays/${holidayId}/document`, { method: "POST", body: fd });
        if (!up.ok) toast.error("Holiday saved, but the document upload failed.");
      }

      toast.success(existing ? "Saved" : "Holiday added");
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
            {existing ? "Edit holiday" : "New holiday"}
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
              <Label>For</Label>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <label key={m.userId} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forPersons.has(m.userId)}
                      onChange={() => togglePerson(m.userId)}
                    />
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
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
                <a href={existing.documentUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline">
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
                  Connect a calendar in <Link href="/settings" className="underline">Settings</Link> to enable.
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
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
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

// guard against unused imports complaining
void addDays;
