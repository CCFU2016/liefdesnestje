"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ListTodo, Plus } from "lucide-react";
import { format, addDays, startOfWeek, isBefore, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type RecipeOption, type MealEntry, type Member, type Absence, fetcher, toYmd, parseYmd } from "./types";

import { MealCardItem } from "./components/meal-card";
import { AddMealDialog } from "./components/add-meal-dialog";
import { ShoppingListDialog } from "./components/shopping-list-dialog";

export function MealsClient({
  recipes,
  currentUserId: _currentUserId,
  members,
}: {
  recipes: RecipeOption[];
  currentUserId: string;
  members: Member[];
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [addDialog, setAddDialog] = useState<{ date: string; entry?: MealEntry } | null>(null);
  const [shoppingDialog, setShoppingDialog] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const rangeFrom = toYmd(weekStart);
  const rangeTo = toYmd(addDays(weekStart, 6));

  const { data, mutate } = useSWR<{ entries: MealEntry[] }>(
    `/api/meals?from=${rangeFrom}&to=${rangeTo}`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const entries = data?.entries ?? [];

  const { data: absData, mutate: mutateAbs } = useSWR<{ absences: Absence[] }>(
    `/api/dinner-absences?from=${rangeFrom}&to=${rangeTo}`,
    fetcher,
    { refreshInterval: 10000 }
  );
  const absenceSet = useMemo(() => {
    const s = new Set<string>();
    for (const a of absData?.absences ?? []) s.add(`${a.userId}|${a.date}`);
    return s;
  }, [absData]);

  const toggleAbsence = async (userId: string, ymd: string) => {
    const k = `${userId}|${ymd}`;
    const willBeAbsent = !absenceSet.has(k);
    // Optimistic update
    mutateAbs(
      (prev) => {
        const cur = prev?.absences ?? [];
        if (willBeAbsent) return { absences: [...cur, { userId, date: ymd }] };
        return { absences: cur.filter((a) => !(a.userId === userId && a.date === ymd)) };
      },
      false
    );
    try {
      const res = await fetch("/api/dinner-absences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, date: ymd, absent: willBeAbsent }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't update — try again.");
    }
    mutateAbs();
  };

  const entriesByDate = useMemo(() => {
    const m = new Map<string, MealEntry[]>();
    for (const e of entries) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return m;
  }, [entries]);

  const removeEntry = async (id: string) => {
    mutate((p) => ({ entries: (p?.entries ?? []).filter((e) => e.id !== id) }), false);
    await fetch(`/api/meals/${id}`, { method: "DELETE" });
    mutate();
  };

  const toggleCooked = async (e: MealEntry) => {
    mutate(
      (p) => ({
        entries: (p?.entries ?? []).map((x) =>
          x.id === e.id
            ? { ...x, cookedAt: e.cookedAt ? null : new Date().toISOString() }
            : x
        ),
      }),
      false
    );
    await fetch(`/api/meals/${e.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cooked: !e.cookedAt }),
    });
    mutate();
  };

  const futureOrTodayEntries = entries.filter(
    (e) => !isBefore(parseYmd(e.date), startOfWeek(new Date(), { weekStartsOn: 1 }))
  );

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Meals</h1>
        <div className="flex gap-2">
          <Link href="/meals/recipes">
            <Button variant="secondary" size="sm">
              Recipe book
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => setShoppingDialog(true)}
            disabled={futureOrTodayEntries.length === 0}
            className="gap-1.5"
          >
            <ListTodo className="h-3.5 w-3.5" />
            Generate shopping list
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <div className="text-sm font-medium">
          {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          className="gap-1"
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex justify-center mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
        >
          This week
        </Button>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {days.map((d) => {
          const ymd = toYmd(d);
          const slotEntries = entriesByDate.get(ymd) ?? [];
          const isToday = isSameDay(d, new Date());
          return (
            <li key={ymd}>
              <Card
                className={`p-3 min-h-[140px] ${isToday ? "ring-1 ring-zinc-900 dark:ring-zinc-50" : ""}`}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-zinc-500">
                      {format(d, "EEE")}
                    </div>
                    <div className="font-semibold">{format(d, "d MMM")}</div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setAddDialog({ date: ymd })}
                    title="Add meal"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {slotEntries.length === 0 ? (
                  <button
                    onClick={() => setAddDialog({ date: ymd })}
                    className="w-full text-left text-xs text-zinc-400 py-2 hover:text-zinc-600"
                  >
                    Plan a meal…
                  </button>
                ) : (
                  <ul className="space-y-2">
                    {slotEntries.map((e) => (
                      <MealCardItem
                        key={e.id}
                        entry={e}
                        onEdit={() => setAddDialog({ date: ymd, entry: e })}
                        onRemove={() => removeEntry(e.id)}
                        onToggleCooked={() => toggleCooked(e)}
                      />
                    ))}
                  </ul>
                )}
                {members.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-1">
                    {members.map((m) => {
                      const isAbsent = absenceSet.has(`${m.userId}|${ymd}`);
                      return (
                        <button
                          key={m.userId}
                          type="button"
                          onClick={() => toggleAbsence(m.userId, ymd)}
                          title={isAbsent ? `${m.displayName} eating out` : `${m.displayName} home`}
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors " +
                            (isAbsent
                              ? "border-amber-300 bg-amber-50 text-amber-900 line-through dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                              : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-400")
                          }
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: m.color }}
                          />
                          {m.displayName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {addDialog && (
        <AddMealDialog
          date={addDialog.date}
          existing={addDialog.entry}
          recipes={recipes}
          onClose={() => setAddDialog(null)}
          onSaved={() => {
            setAddDialog(null);
            mutate();
          }}
        />
      )}

      {shoppingDialog && (
        <ShoppingListDialog
          entries={futureOrTodayEntries}
          onClose={() => setShoppingDialog(false)}
        />
      )}
    </div>
  );
}
