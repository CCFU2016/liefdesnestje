"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEuro } from "@/lib/ah/send-helpers";

export type BonusThisWeekRow = {
  id: number;
  title: string;
  unitSize: string | null;
  price: number | null;
  priceBeforeBonus: number | null;
  bonusLabel: string | null;
  imageUrl: string | null;
  times: number;
};

/**
 * "In the bonus this week": AH's bonus products this nest has bought
 * before, the ones we buy most first. Collapsed to a button until tapped.
 */
export function BonusThisWeekCard({ items, periodEnd }: { items: BonusThisWeekRow[]; periodEnd: string | null }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const regular = items.filter((i) => i.times >= 2).length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">In the bonus this week</CardTitle>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200"
        >
          <Tag className="h-4 w-4" />
          {regular > 0 ? `${regular} we buy often` : `${items.length} bought before`}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md bg-white object-contain" loading="lazy" />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-900" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                    {p.unitSize && <span>{p.unitSize}</span>}
                    {p.price != null && <span>{formatEuro(p.price)}</span>}
                    {p.price == null && p.priceBeforeBonus != null && <span className="line-through">{formatEuro(p.priceBeforeBonus)}</span>}
                    {p.times > 0 && <span>· bought {p.times}× this year</span>}
                  </div>
                </div>
                {p.bonusLabel && (
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                    {p.bonusLabel}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {periodEnd && <p className="mt-2 text-[11px] text-zinc-500">Bonus week ends {periodEnd}. Sorted by how often you buy each product.</p>}
        </CardContent>
      )}
    </Card>
  );
}
