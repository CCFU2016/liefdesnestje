"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ChefHat, ChevronLeft, ChevronRight, ListTodo, MapPin, Plus, Trash2, Check, UtensilsCrossed, Wand2 } from "lucide-react";
import { format, addDays, startOfWeek, isBefore, isSameDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import * as Dialog from "@radix-ui/react-dialog";
import { Input } from "@/components/ui/input";

type RecipeOption = {
  id: string;
  title: string;
  imageUrl: string | null;
  servings: number;
};

type MealEntry = {
  id: string;
  date: string;
  recipeId: string | null;
  freeText: string | null;
  servings: number | null;
  cookedAt: string | null;
  visibility: "private" | "shared";
  authorId: string;
  restaurantName: string | null;
  restaurantUrl: string | null;
  restaurantMenuUrl: string | null;
  restaurantAddress: string | null;
  reservationAt: string | null;
  recipe: {
    id: string;
    title: string;
    imageUrl: string | null;
    servings: number;
    cookTimeMinutes: number | null;
    prepTimeMinutes: number | null;
    ingredients: unknown;
  } | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Member = { userId: string; displayName: string; color: string };

type Absence = { userId: string; date: string };

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

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function MealCardItem({
  entry,
  onEdit,
  onRemove,
  onToggleCooked,
}: {
  entry: MealEntry;
  onEdit: () => void;
  onRemove: () => void;
  onToggleCooked: () => void;
}) {
  const isCooked = !!entry.cookedAt;
  const isRestaurant = !!entry.restaurantName;
  const mapsUrl = buildMapsUrl(entry);
  return (
    <li className="group">
      <div className="flex items-start gap-2">
        {isRestaurant ? (
          <div className="h-10 w-10 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 shrink-0 flex items-center justify-center">
            <UtensilsCrossed className="h-4 w-4" />
          </div>
        ) : entry.recipe?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.recipe.imageUrl}
            alt=""
            className={`h-10 w-10 rounded object-cover shrink-0 ${isCooked ? "opacity-60" : ""}`}
          />
        ) : (
          <div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <button onClick={onEdit} className="text-sm font-medium text-left truncate block w-full">
            <span className={isCooked ? "line-through text-zinc-400" : ""}>
              {entry.restaurantName ?? entry.recipe?.title ?? entry.freeText ?? "Dinner"}
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {entry.reservationAt && (
              <span className="text-[10px] text-zinc-500">
                {format(new Date(entry.reservationAt), "HH:mm")}
              </span>
            )}
            {entry.recipe?.cookTimeMinutes != null && (
              <span className="text-[10px] text-zinc-500">{entry.recipe.cookTimeMinutes} min</span>
            )}
            {entry.visibility === "private" && (
              <span className="text-[10px] text-zinc-500">· private</span>
            )}
            {entry.restaurantMenuUrl && (
              <a
                href={entry.restaurantMenuUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                onClick={(e) => e.stopPropagation()}
              >
                Menu
              </a>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                onClick={(e) => e.stopPropagation()}
              >
                <MapPin className="h-3 w-3" /> Maps
              </a>
            )}
          </div>
        </div>
        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
          {!isRestaurant && (
            <button
              onClick={onToggleCooked}
              className={`p-1 ${isCooked ? "text-emerald-600" : "text-zinc-400 hover:text-zinc-700"}`}
              title={isCooked ? "Unmark as cooked" : "Mark as cooked"}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          {entry.recipe && !isRestaurant && (
            <Link
              href={`/meals/recipes/${entry.recipe.id}/cook`}
              className="p-1 text-zinc-400 hover:text-zinc-700"
              title="Cook mode"
            >
              <ChefHat className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            onClick={onRemove}
            className="p-1 text-zinc-400 hover:text-red-500"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function buildMapsUrl(entry: {
  restaurantName: string | null;
  restaurantAddress: string | null;
}): string | null {
  if (!entry.restaurantName && !entry.restaurantAddress) return null;
  const q = [entry.restaurantName, entry.restaurantAddress].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

type DialogMode = "recipe" | "quick" | "restaurant";

function AddMealDialog({
  date,
  existing,
  recipes,
  onClose,
  onSaved,
}: {
  date: string;
  existing?: MealEntry;
  recipes: RecipeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialMode: DialogMode = existing?.restaurantName
    ? "restaurant"
    : existing?.recipeId
      ? "recipe"
      : existing?.freeText
        ? "quick"
        : "recipe";
  const [mode, setMode] = useState<DialogMode>(initialMode);
  const [recipeId, setRecipeId] = useState<string | null>(existing?.recipeId ?? recipes[0]?.id ?? null);
  const [freeText, setFreeText] = useState(existing?.freeText ?? "");
  const [servings, setServings] = useState<number | "">(existing?.servings ?? "");
  const [isPrivate, setIsPrivate] = useState(existing?.visibility === "private");
  const [busy, setBusy] = useState(false);

  // Restaurant fields
  const [restName, setRestName] = useState(existing?.restaurantName ?? "");
  const [restUrl, setRestUrl] = useState(existing?.restaurantUrl ?? "");
  const [restMenuUrl, setRestMenuUrl] = useState(existing?.restaurantMenuUrl ?? "");
  const [restAddress, setRestAddress] = useState(existing?.restaurantAddress ?? "");
  const [reservationLocal, setReservationLocal] = useState(
    existing
      ? toLocalDatetimeInput(existing.reservationAt)
      : toLocalDatetimeInput(null, date)
  );
  const [extracting, setExtracting] = useState(false);

  const extract = async () => {
    if (!restUrl.trim()) {
      toast.error("Paste a restaurant URL first.");
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch("/api/meals/extract-restaurant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: restUrl.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Extract failed");
      }
      const data = (await res.json()) as {
        name: string | null;
        address: string | null;
        menuUrl: string | null;
      };
      if (data.name && !restName) setRestName(data.name);
      if (data.address && !restAddress) setRestAddress(data.address);
      if (data.menuUrl) setRestMenuUrl(data.menuUrl);
      toast.success("Pulled what I could from the site.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    const payload =
      mode === "restaurant"
        ? {
            date,
            recipeId: null,
            freeText: null,
            servings: null,
            visibility: isPrivate ? "private" : "shared",
            restaurantName: restName.trim() || null,
            restaurantUrl: restUrl.trim() || null,
            restaurantMenuUrl: restMenuUrl.trim() || null,
            restaurantAddress: restAddress.trim() || null,
            reservationAt: reservationLocal ? new Date(reservationLocal).toISOString() : null,
          }
        : {
            date,
            recipeId: mode === "recipe" ? recipeId : null,
            freeText: mode === "quick" ? freeText : null,
            servings: servings === "" ? null : Number(servings),
            visibility: isPrivate ? "private" : "shared",
            restaurantName: null,
            restaurantUrl: null,
            restaurantMenuUrl: null,
            restaurantAddress: null,
            reservationAt: null,
          };
    try {
      if (existing) {
        const res = await fetch(`/api/meals/${existing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch("/api/meals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  const saveDisabled =
    busy ||
    (mode === "recipe" && !recipeId) ||
    (mode === "quick" && !freeText.trim()) ||
    (mode === "restaurant" && !restName.trim());

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">
            {existing ? "Edit meal" : "Add meal"} · {format(parseYmd(date), "EEE d MMM")}
          </Dialog.Title>

          <div className="mt-4 space-y-4">
            <div className="flex gap-1 text-sm">
              <button
                onClick={() => setMode("recipe")}
                className={`flex-1 py-1.5 rounded ${
                  mode === "recipe" ? "bg-zinc-100 dark:bg-zinc-800 font-medium" : "text-zinc-500"
                }`}
              >
                Recipe
              </button>
              <button
                onClick={() => setMode("quick")}
                className={`flex-1 py-1.5 rounded ${
                  mode === "quick" ? "bg-zinc-100 dark:bg-zinc-800 font-medium" : "text-zinc-500"
                }`}
              >
                Quick text
              </button>
              <button
                onClick={() => setMode("restaurant")}
                className={`flex-1 py-1.5 rounded ${
                  mode === "restaurant" ? "bg-zinc-100 dark:bg-zinc-800 font-medium" : "text-zinc-500"
                }`}
              >
                Restaurant
              </button>
            </div>

            {mode === "recipe" && (
              <div className="space-y-1.5">
                {recipes.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No saved recipes yet.{" "}
                    <Link href="/meals/recipes/new" className="underline">Add one</Link>.
                  </p>
                ) : (
                  <select
                    className="w-full h-9 rounded-md border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-800"
                    value={recipeId ?? ""}
                    onChange={(e) => setRecipeId(e.target.value || null)}
                  >
                    <option value="">Select a recipe</option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {mode === "quick" && (
              <Input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder="e.g. Pizza delivery, leftovers, takeaway sushi"
                autoFocus
              />
            )}

            {mode === "restaurant" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Restaurant website (optional)</label>
                  <div className="flex gap-2">
                    <Input
                      value={restUrl}
                      onChange={(e) => setRestUrl(e.target.value)}
                      placeholder="https://…"
                      type="url"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={extract}
                      disabled={extracting || !restUrl.trim()}
                      className="gap-1 whitespace-nowrap"
                      title="Extract name, address, and menu link with Claude"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {extracting ? "Reading…" : "Extract"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Name</label>
                  <Input
                    value={restName}
                    onChange={(e) => setRestName(e.target.value)}
                    placeholder="Restaurant name"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Reservation time (optional)</label>
                  <Input
                    type="datetime-local"
                    value={reservationLocal}
                    onChange={(e) => setReservationLocal(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Address (optional)</label>
                  <Input
                    value={restAddress}
                    onChange={(e) => setRestAddress(e.target.value)}
                    placeholder="Street, city — used for the Maps button"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-500">Menu URL (optional)</label>
                  <Input
                    value={restMenuUrl}
                    onChange={(e) => setRestMenuUrl(e.target.value)}
                    placeholder="https://…"
                    type="url"
                  />
                </div>
              </div>
            )}

            {mode !== "restaurant" && (
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500">Servings (optional)</label>
                <Input
                  type="number"
                  min={1}
                  value={servings}
                  onChange={(e) => setServings(e.target.value ? Number(e.target.value) : "")}
                  placeholder="defaults to recipe's serving count"
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              Private (only visible to you)
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saveDisabled}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Format an ISO timestamp into the YYYY-MM-DDTHH:mm string that
// <input type="datetime-local"> expects, in the user's local zone. When
// `seedYmd` is provided and `iso` is null we default to that date at 19:00
// so creating a brand-new restaurant entry only requires tweaking the hour.
function toLocalDatetimeInput(iso: string | null, seedYmd?: string): string {
  let d: Date | null = null;
  if (iso) {
    d = new Date(iso);
  } else if (seedYmd && /^\d{4}-\d{2}-\d{2}$/.test(seedYmd)) {
    const [y, m, dd] = seedYmd.split("-").map(Number);
    d = new Date(y, m - 1, dd, 19, 0);
  }
  if (!d || Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ShoppingListDialog({
  entries,
  onClose,
}: {
  entries: MealEntry[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(entries.filter((e) => e.recipe).map((e) => e.id))
  );
  const [preview, setPreview] = useState<
    | null
    | {
        items: Array<{ name: string; totalAmount: string; unit: string | null; sourceRecipes: string[] }>;
        fallback: boolean;
      }
  >(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const run = async (commit: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/meals/shopping-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryIds: Array.from(selected), preview: !commit }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed");
      if (!commit) {
        setPreview({ items: body.items, fallback: body.fallback });
      } else {
        toast.success(`Pushed ${body.insertedCount} items to your groceries list${body.fallback ? " (fallback list — aggregation couldn't run)" : ""}.`);
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[80vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">Generate shopping list</Dialog.Title>
          {!preview && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-zinc-500">Pick which meals to include:</p>
              <ul className="space-y-1">
                {entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      disabled={!e.recipe}
                    />
                    <span className="flex-1 min-w-0 truncate">
                      {format(parseYmd(e.date), "EEE d MMM")} · {e.recipe?.title ?? e.freeText}
                    </span>
                    {!e.recipe && (
                      <span className="text-[10px] text-zinc-400">no recipe</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button onClick={() => run(false)} disabled={busy || selected.size === 0}>
                  {busy ? "Working…" : "Preview list"}
                </Button>
              </div>
            </div>
          )}

          {preview && (
            <div className="mt-4 space-y-3">
              {preview.fallback && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-2 text-xs text-amber-900 dark:text-amber-200">
                  Aggregation couldn&apos;t run (Claude call failed) — showing a plain list of every ingredient separately. You can still push it.
                </div>
              )}
              <p className="text-sm text-zinc-500">{preview.items.length} items will be added to your Groceries list:</p>
              <ul className="space-y-1 text-sm max-h-64 overflow-y-auto">
                {preview.items.map((item, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span>
                      <span className="font-medium">{[item.totalAmount, item.unit].filter(Boolean).join(" ")}</span>{" "}
                      {item.name}
                    </span>
                    <span className="text-[10px] text-zinc-400 truncate max-w-[40%]">
                      {item.sourceRecipes.slice(0, 2).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>Back</Button>
                <Button onClick={() => run(true)} disabled={busy}>
                  {busy ? "Pushing…" : "Push to Groceries"}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
