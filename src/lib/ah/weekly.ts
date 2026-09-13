import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ahBonusActivations } from "@/lib/db/schema";
import { todayInAmsterdam } from "@/lib/chores/schedule";
import { activatePersonalPromotion, getBonusPeriods, getPersonalSegments, getPreviouslyBoughtBonus, getSegmentProducts, periodFor, type BonusPeriod } from "./bonus-pages";
import { withAhConnection } from "./connection";
import type { AhProduct } from "./products";
import { getPurchaseStats, syncReceipts } from "./receipt-sync";
import { pickActivations, rankBonusThisWeek, type BonusThisWeekItem, type SegmentCandidate } from "./weekly-helpers";

// The weekly Bonus Box job and the "in the bonus this week" list.

const MAX_ACTIVATIONS_FALLBACK = 10;

export type WeeklyResult = {
  receipts: { imported: number; linesMapped: number; linesUnmapped: number };
  periods: Array<{
    start: string;
    end: string;
    offers: number;
    alreadyActivated: number;
    activated: Array<{ id: string; title: string; score: number; status: string; message: string | null }>;
  }>;
};

/**
 * Imports new receipts, then for the current and the next bonus week
 * activates the Bonus Box offers whose products the household buys most.
 * Offers already activated (in the app or by an earlier run) are left alone.
 */
export async function runWeekly(householdId: string, opts: { dryRun?: boolean } = {}): Promise<WeeklyResult> {
  return withAhConnection(householdId, async (token) => {
    const receipts = await syncReceipts(householdId, token);
    const stats = await getPurchaseStats(householdId, { sinceDays: 365 });

    const today = todayInAmsterdam();
    const periods = (await getBonusPeriods(token)).filter((p) => p.end >= today).slice(0, 2);
    const result: WeeklyResult = { receipts, periods: [] };

    for (const period of periods) {
      const segments = await getPersonalSegments(token, period);
      const candidates: SegmentCandidate[] = [];
      for (const s of segments) {
        // Products are only needed for offers we might activate.
        const productIds = s.activated || s.productCount > 30 ? [] : (await getSegmentProducts(token, s.id, period)).map((p) => p.id);
        candidates.push({ ...s, productIds });
      }
      const picks = pickActivations(candidates, stats, { maxActivations: MAX_ACTIVATIONS_FALLBACK });
      const entry: WeeklyResult["periods"][number] = {
        start: period.start,
        end: period.end,
        offers: candidates.filter((c) => c.productCount <= 30).length,
        alreadyActivated: candidates.filter((c) => c.activated && c.productCount <= 30).length,
        activated: [],
      };
      for (const pick of picks) {
        let status = "dry-run";
        let message: string | null = null;
        if (!opts.dryRun) {
          try {
            const res = await activatePersonalPromotion(token, pick.id, period.start);
            status = res.status ?? "unknown";
            message = res.message;
          } catch (e) {
            status = "failed";
            message = e instanceof Error ? e.message.slice(0, 200) : String(e);
          }
        }
        await db
          .insert(ahBonusActivations)
          .values({ householdId, segmentId: pick.id, title: pick.title, discount: null, periodStart: period.start, periodEnd: period.end, score: pick.score, status, message })
          .onConflictDoUpdate({
            target: [ahBonusActivations.householdId, ahBonusActivations.segmentId, ahBonusActivations.periodStart],
            set: { score: pick.score, status, message, createdAt: new Date() },
          });
        entry.activated.push({ id: pick.id, title: pick.title, score: pick.score, status, message });
      }
      // Confirm against AH rather than trusting the mutation's status string.
      if (!opts.dryRun && picks.length) {
        const after = await getPersonalSegments(token, period);
        for (const a of entry.activated) {
          const confirmed = after.find((s) => s.id === a.id)?.activated === true;
          const status = confirmed ? "activated" : a.status === "failed" ? "failed" : `unconfirmed (${a.status})`;
          a.status = status;
          await db
            .update(ahBonusActivations)
            .set({ status })
            .where(and(eq(ahBonusActivations.householdId, householdId), eq(ahBonusActivations.segmentId, a.id), eq(ahBonusActivations.periodStart, period.start)));
        }
      }
      result.periods.push(entry);
    }
    return result;
  });
}

export async function recentActivations(householdId: string, limit = 12) {
  return db
    .select()
    .from(ahBonusActivations)
    .where(eq(ahBonusActivations.householdId, householdId))
    .orderBy(desc(ahBonusActivations.createdAt))
    .limit(limit);
}

// --- "in the bonus this week" -----------------------------------------------

const cache = new Map<string, { at: number; period: BonusPeriod | null; items: BonusThisWeekItem[] }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type BonusThisWeek = { period: BonusPeriod | null; items: BonusThisWeekItem[] };

/**
 * AH's "bonus for products you bought before", ordered by our own purchase
 * counts. Cached six hours per household; empty when AH is unreachable.
 */
export async function getBonusThisWeek(householdId: string): Promise<BonusThisWeek> {
  const hit = cache.get(householdId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { period: hit.period, items: hit.items };
  try {
    const out = await withAhConnection(householdId, async (token) => {
      const today = todayInAmsterdam();
      const periods = await getBonusPeriods(token);
      const period = periodFor(periods, today) ?? periods[0] ?? null;
      const products: AhProduct[] = await getPreviouslyBoughtBonus(token, period?.start ?? today);
      const stats = await getPurchaseStats(householdId, { sinceDays: 365 });
      return { period, items: rankBonusThisWeek(products, stats) };
    });
    cache.set(householdId, { at: Date.now(), ...out });
    return out;
  } catch (e) {
    console.warn("bonus this week unavailable:", e instanceof Error ? e.message : e);
    return { period: null, items: [] };
  }
}

export function _resetBonusThisWeekCacheForTests() {
  cache.clear();
}
