"use client";

import { useMemo } from "react";
import useSWR from "swr";

export type BonusTag = { label: string; endDate: string | null; productTitle: string };

async function fetchBonus(names: string[]): Promise<Record<string, BonusTag>> {
  try {
    const res = await fetch("/api/integrations/albert-heijn/bonus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ names }),
    });
    if (!res.ok) return {};
    const body = await res.json();
    return body.bonus ?? {};
  } catch {
    return {};
  }
}

/**
 * Bonus tags for ingredient names, fetched once per distinct set and kept
 * for an hour on the client. Empty when AH is unreachable, so callers just
 * render nothing.
 */
export function useAhBonus(names: string[]): Record<string, BonusTag> {
  const unique = useMemo(() => Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).sort(), [names]);
  const key = unique.length ? ["ah-bonus", unique.join("")] : null;
  const { data } = useSWR(key, () => fetchBonus(unique), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 60 * 60 * 1000,
  });
  return data ?? {};
}
