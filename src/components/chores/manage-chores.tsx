"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Chore = {
  id: string;
  title: string;
  notes: string | null;
  daysOfWeek: number[];
  startsOn: string | null;
  endsOn: string | null;
  pointsValue: number;
  rollsOver: boolean;
  visibility: "private" | "shared";
};

type Payload = { date: string; scheduledToday: { chore: Chore }[]; carryover: { chore: Chore }[] };

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const STORAGE_KEY = "liefdesnestje:manage-chores-open";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return "Weekdays";
  if (days.length === 2 && [0, 6].every((d) => days.includes(d))) return "Weekends";
  return [...days].sort().map((d) => DAY_LABELS[d]).join(" · ");
}

export function ManageChores() {
  // The /api/chores endpoint already returns every live chore in the
  // household (via scheduledToday + carryover, plus an "everything" mode
  // we don't have). For Manage we want all chores regardless of today —
  // we get them from a dedicated query. The simplest route: hit the same
  // GET and union both arrays' chores deduped. It surfaces every chore
  // that's either scheduled today or has carryover. Anything truly
  // unscheduled-this-week wouldn't appear, so we add a fetch of the next
  // 7 days to ensure we surface every one. That's overkill — instead
  // we fetch the canonical "all chores" list via the same endpoint with
  // a fixed date that hits each day-of-week.
  //
  // Pragmatic: re-fetch /api/chores 7 times (once per weekday this week)
  // and union the chores. Cheap because it's local and chore counts are
  // small. Keeps the API surface tiny.
  const week = useSWR<Payload[]>("manage-chores-week", () => fetchWeek(), {
    refreshInterval: 60_000,
  });

  const allChores = (() => {
    const map = new Map<string, Chore>();
    for (const day of week.data ?? []) {
      for (const r of day.scheduledToday) map.set(r.chore.id, r.chore);
      for (const r of day.carryover) map.set(r.chore.id, r.chore);
    }
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  })();

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOpen(localStorage.getItem(STORAGE_KEY) === "1");
    }
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    }
  }, [open]);

  const [editing, setEditing] = useState<Chore | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = async (id: string) => {
    if (!confirm("Delete this chore? Past completions stay; future occurrences disappear.")) return;
    try {
      const res = await fetch(`/api/chores/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Removed.");
      week.mutate();
    } catch {
      toast.error("Couldn't remove — try again.");
    }
  };

  return (
    <>
      <Card className="mb-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-zinc-500" />
            Manage chores
          </CardTitle>
          <ChevronDown
            className={
              "h-4 w-4 text-zinc-500 transition-transform " + (open ? "rotate-180" : "")
            }
          />
        </button>
        {open && (
          <CardContent>
            <div className="mb-3">
              <Button
                size="sm"
                onClick={() => setCreating(true)}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                New chore
              </Button>
            </div>
            {allChores.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No chores set up yet. Add one — vacuuming on Thursdays, plants on Wednesdays, etc.
              </p>
            ) : (
              <ul className="space-y-2">
                {allChores.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-xs text-zinc-500 truncate">
                        {formatDays(c.daysOfWeek)} · {c.pointsValue} pt
                        {c.rollsOver ? " · stays until done" : ""}
                        {c.visibility === "private" ? " · private" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <button
                        onClick={() => setEditing(c)}
                        className="p-1 text-zinc-400 hover:text-zinc-700"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => remove(c.id)}
                        className="p-1 text-zinc-400 hover:text-red-500"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        )}
      </Card>

      {(creating || editing) && (
        <ChoreDialog
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            week.mutate();
          }}
        />
      )}
    </>
  );
}

// Hits /api/chores once per weekday in the current ISO week so the union of
// scheduledToday + carryover across responses covers every live chore.
async function fetchWeek(): Promise<Payload[]> {
  // Compute Monday of this week in Europe/Amsterdam. We can do this via
  // Intl by formatting the date in CA locale (YYYY-MM-DD).
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, mo, d] = today.split("-").map(Number);
  // Find Monday: JS getUTCDay 0=Sun. Treat date as UTC for arithmetic.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dow = dt.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - offset);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const ymd = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    dates.push(ymd);
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  const responses = await Promise.all(
    dates.map((d) => fetch(`/api/chores?date=${d}`).then((r) => r.json()))
  );
  return responses;
}

function ChoreDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: Chore | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [days, setDays] = useState<number[]>(existing?.daysOfWeek ?? [1]); // Monday default
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "");
  const [points, setPoints] = useState<number>(existing?.pointsValue ?? 1);
  const [rollsOver, setRollsOver] = useState(existing?.rollsOver ?? false);
  const [isPrivate, setIsPrivate] = useState(existing?.visibility === "private");
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const save = async () => {
    if (!title.trim()) {
      toast.error("Give it a title.");
      return;
    }
    if (days.length === 0) {
      toast.error("Pick at least one day.");
      return;
    }
    if (startsOn && endsOn && startsOn > endsOn) {
      toast.error("End date must be on or after the start date.");
      return;
    }
    setBusy(true);
    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      daysOfWeek: days.sort(),
      startsOn: startsOn || null,
      endsOn: endsOn || null,
      pointsValue: points,
      rollsOver,
      visibility: isPrivate ? "private" : "shared",
    };
    try {
      const url = existing ? `/api/chores/${existing.id}` : "/api/chores";
      const res = await fetch(url, {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">
            {existing ? "Edit chore" : "New chore"}
          </Dialog.Title>

          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Vacuum, water plants, take out bins…"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Days of week</label>
              <div className="grid grid-cols-7 gap-1 text-xs">
                {/* Mon-first display order (1, 2, 3, 4, 5, 6, 0) */}
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={
                        "py-1.5 rounded border " +
                        (on
                          ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                          : "border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400")
                      }
                      aria-pressed={on}
                    >
                      {DAY_LABELS[d]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Start date (optional)</label>
                <Input
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">End date (optional)</label>
                <Input
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Points (1–10)</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={points}
                onChange={(e) => setPoints(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800 min-h-[60px]"
                placeholder="Anything specific — frequency, location, equipment…"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rollsOver}
                onChange={(e) => setRollsOver(e.target.checked)}
              />
              Stays until done (missed days carry over to the next day)
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              Private (only you see it; your points still count)
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !title.trim() || days.length === 0}>
              {busy ? "Saving…" : existing ? "Save changes" : "Create chore"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
