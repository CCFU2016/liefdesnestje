"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { addDays, format, getISOWeek, getISOWeekYear, startOfWeek } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Member = { userId: string; displayName: string; color: string };

type Entry = { userId: string; date: string; absent: boolean };

// Shown on Saturdays and Sundays to set next week's dinner attendance.
// One shot per week per browser — dismissal (or completion) stores a key
// keyed by the *target* ISO week so the prompt returns for the following
// week's nudge.

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoWeekKey(d: Date): string {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`;
}

function nextWeekStart(today: Date): Date {
  // date-fns weekStartsOn: 1 = Monday. Next Monday from today.
  const thisMonday = startOfWeek(today, { weekStartsOn: 1 });
  return addDays(thisMonday, 7);
}

export function DinnerWeeklyPrompt({ members }: { members: Member[] }) {
  const today = useMemo(() => new Date(), []);
  const day = today.getDay(); // 0=Sun, 6=Sat
  const isWeekendNudge = day === 0 || day === 6;

  const targetMonday = useMemo(() => nextWeekStart(today), [today]);
  const weekKey = useMemo(() => isoWeekKey(targetMonday), [targetMonday]);
  const storageKey = `dinnerWeeklyPrompt:${weekKey}`;

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(targetMonday, i)),
    [targetMonday]
  );

  const [open, setOpen] = useState(false);
  // absence set keyed by `${userId}|${ymd}` — present = marked absent
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isWeekendNudge) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(storageKey)) return;
    setOpen(true);
  }, [isWeekendNudge, storageKey]);

  useEffect(() => {
    if (!open || loaded) return;
    const from = toYmd(days[0]);
    const to = toYmd(days[6]);
    fetch(`/api/dinner-absences?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: { absences?: { userId: string; date: string }[] }) => {
        const next = new Set<string>();
        for (const a of d.absences ?? []) next.add(`${a.userId}|${a.date}`);
        setAbsent(next);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, days]);

  const toggle = (userId: string, ymd: string) => {
    setAbsent((prev) => {
      const next = new Set(prev);
      const k = `${userId}|${ymd}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    const entries: Entry[] = [];
    for (const m of members) {
      for (const d of days) {
        const ymd = toYmd(d);
        entries.push({ userId: m.userId, date: ymd, absent: absent.has(`${m.userId}|${ymd}`) });
      }
    }
    try {
      const res = await fetch("/api/dinner-absences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!res.ok) throw new Error(await res.text());
      localStorage.setItem(storageKey, "done");
      setOpen(false);
      toast.success("Dinner plan saved for next week.");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const dismiss = () => {
    localStorage.setItem(storageKey, "dismissed");
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : dismiss())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(560px,calc(100vw-2rem))] max-h-[85vh] overflow-auto rounded-lg bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-5">
          <Dialog.Title className="text-lg font-semibold">
            Who&apos;s eating at home next week?
          </Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-500 mt-1">
            Tap a day to mark someone as eating out. Covers{" "}
            {format(days[0], "d MMM")} – {format(days[6], "d MMM")}.
          </Dialog.Description>

          <div className="mt-4 space-y-4">
            {members.map((m) => (
              <div key={m.userId}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: m.color }}
                  />
                  <span className="text-sm font-medium">{m.displayName}</span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {days.map((d) => {
                    const ymd = toYmd(d);
                    const isAbsent = absent.has(`${m.userId}|${ymd}`);
                    return (
                      <button
                        key={ymd}
                        type="button"
                        onClick={() => toggle(m.userId, ymd)}
                        className={
                          "flex flex-col items-center justify-center rounded-md px-1 py-2 text-xs border transition-colors " +
                          (isAbsent
                            ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                            : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300")
                        }
                        aria-pressed={isAbsent}
                        title={isAbsent ? "Eating out" : "At home"}
                      >
                        <span className="uppercase tracking-wider text-[10px] opacity-70">
                          {format(d, "EEE")}
                        </span>
                        <span className="font-semibold">{format(d, "d")}</span>
                        <span className="text-[10px] mt-0.5">
                          {isAbsent ? "out" : "home"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={dismiss} disabled={saving}>
              Skip for now
            </Button>
            <Button type="button" onClick={save} disabled={saving || !loaded}>
              {saving ? "Saving…" : "Save plan"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
