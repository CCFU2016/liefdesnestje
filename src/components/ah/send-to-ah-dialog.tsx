"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus, ShoppingBasket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatEuro, summarizeSelections } from "@/lib/ah/send-helpers";
import type { AhProduct } from "@/lib/ah/products";
import type { PreparedItem } from "@/lib/ah/send";

export type SendItem = { todoId?: string | null; title: string };

type Row = PreparedItem & { asText: boolean; open: boolean };

/**
 * "Send to Albert Heijn": review the product picked for every grocery item,
 * swap or fall back to text, set pack counts, then send in one go. Bottom
 * sheet on a phone, centred dialog on a wide screen.
 */
export function SendToAhDialog({
  items,
  onClose,
  onSent,
}: {
  items: SendItem[];
  onClose: () => void;
  /** Called with the to-do ids that were sent, after AH confirmed. */
  onSent?: (todoIds: string[]) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sent: number; listSize: number; todoIds: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/integrations/albert-heijn/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(body.error ?? "Couldn't prepare the list"), { code: body.code });
        if (cancelled) return;
        setRows((body.items as PreparedItem[]).map((it) => ({ ...it, asText: it.selectedProductId == null, open: false })));
      } catch (e) {
        if (cancelled) return;
        setError({ message: e instanceof Error ? e.message : "Couldn't prepare the list", code: (e as { code?: string }).code });
      }
    })();
    return () => {
      cancelled = true;
    };
    // items is stable for the life of the dialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = (r: Row): AhProduct | null => (r.asText ? null : (r.candidates.find((c) => c.id === r.selectedProductId) ?? null));

  const summary = useMemo(() => summarizeSelections((rows ?? []).map((r) => ({ product: selected(r), packs: r.packs }))), [rows]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => (prev ? prev.map((r) => (r.key === key && r.todoId === (patch.todoId ?? r.todoId) ? { ...r, ...patch } : r)) : prev));

  const send = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const selections = rows.map((r) => {
        const p = selected(r);
        return {
          todoId: r.todoId,
          key: r.key,
          title: r.title,
          packs: r.packs,
          productId: p?.id ?? null,
          productTitle: p?.title ?? null,
          imageUrl: p?.imageUrl ?? null,
        };
      });
      const res = await fetch("/api/integrations/albert-heijn/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selections }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.error ?? "Sending failed"), { code: body.code });
      const todoIds = rows.map((r) => r.todoId).filter((id): id is string => !!id);
      setDone({ sent: body.sent, listSize: body.listSize, todoIds });
      onSent?.(todoIds);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "not-connected" || code === "reconnect") setError({ message: e instanceof Error ? e.message : "Sending failed", code });
      else toast.error(e instanceof Error ? e.message : "Couldn't reach Albert Heijn right now — your list here is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  const tickOff = async () => {
    if (!done) return;
    setBusy(true);
    try {
      await Promise.all(
        done.todoIds.map((id) =>
          fetch(`/api/todos/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ completed: true }),
          })
        )
      );
      toast.success("Ticked off here too");
    } catch {
      toast.error("Couldn't tick them off. You can do it by hand.");
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[92vw] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
          <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <ShoppingBasket className="h-4 w-4 text-zinc-500" />
            <Dialog.Title className="text-base font-semibold">Send to Albert Heijn</Dialog.Title>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {error && (
              <div className="space-y-3 py-4 text-sm">
                <p>{error.message}</p>
                {(error.code === "not-connected" || error.code === "reconnect") && (
                  <Link href="/settings#albert-heijn" className="underline">
                    Open Settings → Albert Heijn
                  </Link>
                )}
              </div>
            )}

            {!error && !rows && !done && <p className="py-6 text-center text-sm text-zinc-500">Looking up products…</p>}

            {done && (
              <div className="space-y-3 py-4 text-sm">
                <p>
                  Sent {done.sent} {done.sent === 1 ? "item" : "items"} to Mijn lijst in the Appie app. The list there now has {done.listSize}{" "}
                  {done.listSize === 1 ? "item" : "items"}.
                </p>
                {done.todoIds.length > 0 && <p className="text-zinc-500">Tick these off here too?</p>}
              </div>
            )}

            {rows && !done && (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {rows.map((r) => {
                  const p = selected(r);
                  const rowId = `${r.key}:${r.todoId ?? ""}`;
                  return (
                    <li key={rowId} className="py-3">
                      <div className="flex items-start gap-3">
                        {p?.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-contain bg-white" loading="lazy" />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-[10px] text-zinc-500 dark:bg-zinc-900">
                            {r.asText ? "text" : "?"}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-zinc-500">{r.title}</div>
                          {p ? (
                            <>
                              <div className="truncate text-sm font-medium">{p.title}</div>
                              <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                                {p.unitSize && <span>{p.unitSize}</span>}
                                {p.price != null && <span>{formatEuro(p.price)}</span>}
                                {p.isBonus && (
                                  <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                                    Bonus{p.bonusLabel ? ` · ${p.bonusLabel}` : ""}
                                  </span>
                                )}
                                {r.remembered && <span className="text-[10px]">as last time</span>}
                              </div>
                            </>
                          ) : (
                            <div className="text-sm font-medium">Added as text{r.candidates.length === 0 ? " (no product found)" : ""}</div>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <div className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-800">
                              <button
                                type="button"
                                aria-label="Fewer packs"
                                className="px-2 py-1 disabled:opacity-40"
                                disabled={r.packs <= 1}
                                onClick={() => update(r.key, { todoId: r.todoId, packs: r.packs - 1 })}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="min-w-[2ch] text-center text-sm tabular-nums">{r.packs}</span>
                              <button
                                type="button"
                                aria-label="More packs"
                                className="px-2 py-1 disabled:opacity-40"
                                disabled={r.packs >= 20}
                                onClick={() => update(r.key, { todoId: r.todoId, packs: r.packs + 1 })}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {r.note && <span className="text-[11px] text-zinc-500">{r.note}</span>}
                            {(r.candidates.length > 1 || (r.asText && r.candidates.length > 0)) && (
                              <button type="button" className="text-xs underline" onClick={() => update(r.key, { todoId: r.todoId, open: !r.open })}>
                                {r.open ? "Hide options" : "Swap"}
                              </button>
                            )}
                            {!r.asText && (
                              <button type="button" className="text-xs underline" onClick={() => update(r.key, { todoId: r.todoId, asText: true, open: false })}>
                                Just add as text
                              </button>
                            )}
                          </div>
                          {r.open && (
                            <ul className="mt-2 space-y-1">
                              {r.candidates.map((c) => (
                                <li key={c.id}>
                                  <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-800">
                                    <input
                                      type="radio"
                                      name={`cand-${rowId}`}
                                      checked={!r.asText && r.selectedProductId === c.id}
                                      onChange={() => update(r.key, { todoId: r.todoId, selectedProductId: c.id, asText: false, open: false })}
                                    />
                                    {c.imageUrl && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={c.imageUrl} alt="" className="h-8 w-8 rounded object-contain bg-white" loading="lazy" />
                                    )}
                                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                                    <span className="shrink-0 text-zinc-500">
                                      {c.unitSize ? `${c.unitSize} · ` : ""}
                                      {c.price != null ? formatEuro(c.price) : ""}
                                      {c.isBonus ? " · bonus" : ""}
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            {rows && !done && (
              <div className="mb-2 text-xs text-zinc-500">
                {summary.estimate != null && <span>≈ {formatEuro(summary.estimate)}</span>}
                {summary.estimate != null && summary.priced < summary.productCount && <span> (some without a price)</span>}
                {summary.bonusCount > 0 && <span> · {summary.bonusCount} in bonus</span>}
                {summary.textCount > 0 && <span> · {summary.textCount} as text</span>}
              </div>
            )}
            <div className="flex justify-end gap-2">
              {done ? (
                <>
                  <Button variant="ghost" onClick={onClose} disabled={busy}>
                    {done.todoIds.length > 0 ? "No, keep them" : "Close"}
                  </Button>
                  {done.todoIds.length > 0 && (
                    <Button onClick={tickOff} disabled={busy}>
                      {busy ? "Ticking off…" : "Yes, tick them off"}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={onClose} disabled={busy}>
                    Cancel
                  </Button>
                  <Button onClick={send} disabled={busy || !rows || rows.length === 0 || !!error}>
                    {busy ? "Sending…" : `Send ${rows?.length ?? ""} ${rows?.length === 1 ? "item" : "items"}`}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
