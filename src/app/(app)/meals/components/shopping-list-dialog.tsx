"use client";

import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { type MealEntry, parseYmd } from "../types";

export function ShoppingListDialog({
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
