"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { Input } from "@/components/ui/input";
import { type RecipeOption, type MealEntry, parseYmd } from "../types";

type DialogMode = "recipe" | "quick" | "restaurant";

export function AddMealDialog({
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
