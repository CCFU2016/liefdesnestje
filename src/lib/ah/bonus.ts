import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ahProductMatches } from "@/lib/db/schema";
import { getProductsByIds, type AhProduct } from "./products";
import { normalizeItemKey } from "./send-helpers";

// Bonus awareness: which of a household's remembered AH products are in
// bonus right now. Anonymous token, one batched products-by-id call for
// whatever is not cached, and nothing for items never sent to AH.

export type BonusTag = { label: string; endDate: string | null; productTitle: string };

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<number, { product: AhProduct | null; at: number }>();

/** Test hook. */
export function _resetBonusCacheForTests() {
  cache.clear();
}

/**
 * Pure: builds the name → tag map from the remembered matches and the
 * products looked up for them. Only products currently in bonus get a tag.
 */
export function bonusTagsForNames(
  names: string[],
  matchesByKey: Map<string, { ahProductId: number }>,
  productById: Map<number, AhProduct | null>
): Record<string, BonusTag> {
  const out: Record<string, BonusTag> = {};
  for (const name of names) {
    const key = normalizeItemKey(name);
    const match = matchesByKey.get(key);
    if (!match) continue;
    const p = productById.get(match.ahProductId);
    if (!p || !p.isBonus) continue;
    out[name] = { label: p.bonusLabel ?? "Bonus", endDate: p.bonusEndDate, productTitle: p.title };
  }
  return out;
}

export async function getBonusTags(householdId: string, names: string[]): Promise<Record<string, BonusTag>> {
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 200);
  if (unique.length === 0) return {};
  const keys = Array.from(new Set(unique.map(normalizeItemKey))).filter(Boolean);
  if (keys.length === 0) return {};

  const matches = await db
    .select({ itemKey: ahProductMatches.itemKey, ahProductId: ahProductMatches.ahProductId })
    .from(ahProductMatches)
    .where(and(eq(ahProductMatches.householdId, householdId), inArray(ahProductMatches.itemKey, keys)));
  if (matches.length === 0) return {};
  const matchesByKey = new Map(matches.map((m) => [m.itemKey, m]));

  const now = Date.now();
  const ids = Array.from(new Set(matches.map((m) => m.ahProductId)));
  const stale = ids.filter((id) => {
    const c = cache.get(id);
    return !c || now - c.at > CACHE_TTL_MS;
  });
  if (stale.length) {
    try {
      const fresh = await getProductsByIds(stale);
      const freshById = new Map(fresh.map((p) => [p.id, p]));
      for (const id of stale) cache.set(id, { product: freshById.get(id) ?? null, at: now });
    } catch (e) {
      // Bonus tags are decoration: an AH hiccup means no tags, not an error.
      console.warn("bonus lookup failed:", e instanceof Error ? e.message : e);
    }
  }
  const productById = new Map(ids.map((id) => [id, cache.get(id)?.product ?? null]));
  return bonusTagsForNames(unique, matchesByKey, productById);
}
