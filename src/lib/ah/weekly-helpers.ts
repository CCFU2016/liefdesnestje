// Pure ranking helpers for the Bonus Box job and the "in the bonus this
// week" list; unit-tested, no I/O.

import type { AhProduct } from "./products";

export type SegmentCandidate = {
  id: string;
  title: string;
  activated: boolean;
  productCount: number;
  /** webshop ids of the products the offer covers */
  productIds: number[];
};

export type Stat = { times: number };

// The Bio Premium / Terra Premium programme segments list hundreds of
// products and are not offers to pick; a real Bonus Box offer covers a few.
export const MAX_OFFER_PRODUCTS = 30;

export function isProgrammeSegment(s: { productCount: number }): boolean {
  return s.productCount > MAX_OFFER_PRODUCTS;
}

/** Times the household bought any product the offer covers. */
export function scoreSegment(s: SegmentCandidate, stats: Map<number, Stat>): number {
  let score = 0;
  for (const id of s.productIds) score += stats.get(id)?.times ?? 0;
  return score;
}

/**
 * Which not-yet-activated offers to activate: those whose products were
 * bought at least `minTimes` times, best first, at most `slots`.
 */
export function pickActivations(
  segments: SegmentCandidate[],
  stats: Map<number, Stat>,
  opts: { maxActivations: number; minTimes?: number }
): Array<SegmentCandidate & { score: number }> {
  const minTimes = opts.minTimes ?? 2;
  const activated = segments.filter((s) => s.activated && !isProgrammeSegment(s)).length;
  const slots = Math.max(0, opts.maxActivations - activated);
  return segments
    .filter((s) => !s.activated && !isProgrammeSegment(s))
    .map((s) => ({ ...s, score: scoreSegment(s, stats) }))
    .filter((s) => s.score >= minTimes)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, slots);
}

export type BonusThisWeekItem = AhProduct & { times: number };

/**
 * Orders "bonus for products you bought before" by how often we actually
 * buy them; products AH lists but we have no receipt line for come last.
 */
export function rankBonusThisWeek(products: AhProduct[], stats: Map<number, Stat>): BonusThisWeekItem[] {
  return products
    .map((p) => ({ ...p, times: stats.get(p.id)?.times ?? 0 }))
    .sort((a, b) => b.times - a.times || a.title.localeCompare(b.title));
}
