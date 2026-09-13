import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ahConnections, ahPosProducts, ahReceiptLines, ahReceipts } from "@/lib/db/schema";
import { convertPosProductId } from "./bonus-pages";
import { getReceipt, listReceipts } from "./receipts";

// Imports in-store receipts into our own tables and answers "how often do
// we buy this?" from them. Incremental: pages of receipts are read newest
// first until a known one turns up.

const PAGE = 50;
const MAX_NEW_PER_RUN = 600;

export type SyncResult = { imported: number; linesMapped: number; linesUnmapped: number };

export async function syncReceipts(householdId: string, token: string): Promise<SyncResult> {
  const known = new Set((await db.select({ id: ahReceipts.id }).from(ahReceipts).where(eq(ahReceipts.householdId, householdId))).map((r) => r.id));

  const fresh: Array<{ id: string; dateTime: string; total: number | null }> = [];
  for (let offset = 0; fresh.length < MAX_NEW_PER_RUN; offset += PAGE) {
    const page = await listReceipts(token, offset, PAGE);
    let sawKnown = false;
    for (const r of page) {
      if (known.has(r.id)) sawKnown = true;
      else fresh.push(r);
    }
    if (page.length < PAGE || (sawKnown && known.size > 0)) break;
  }

  let linesMapped = 0;
  let linesUnmapped = 0;
  const posCache = new Map<number, number | null>();
  for (const row of await db.select().from(ahPosProducts)) posCache.set(row.posProductId, row.webshopId);

  for (const summary of fresh) {
    const receipt = await getReceipt(token, summary.id);
    if (!receipt) continue;
    const lines = [];
    for (const line of receipt.lines) {
      const posId = line.productId && /^\d+$/.test(line.productId) ? Number(line.productId) : null;
      let webshopId: number | null = null;
      if (posId != null) {
        if (!posCache.has(posId)) {
          let mapped: number | null = null;
          try {
            mapped = await convertPosProductId(token, posId);
          } catch {
            mapped = null;
          }
          posCache.set(posId, mapped);
          await db.insert(ahPosProducts).values({ posProductId: posId, webshopId: mapped }).onConflictDoNothing();
        }
        webshopId = posCache.get(posId) ?? null;
      }
      if (webshopId) linesMapped++;
      else linesUnmapped++;
      lines.push({
        receiptId: receipt.id,
        householdId,
        posProductId: posId,
        webshopId,
        name: line.name.slice(0, 500),
        quantity: line.quantity,
        amount: line.amount,
        inBonus: line.bonusKind != null,
        bonusKind: line.bonusKind,
      });
    }
    await db
      .insert(ahReceipts)
      .values({ id: receipt.id, householdId, boughtAt: new Date(summary.dateTime), total: receipt.total ?? summary.total })
      .onConflictDoNothing();
    if (lines.length) await db.insert(ahReceiptLines).values(lines);
  }

  await db.update(ahConnections).set({ receiptsSyncedAt: new Date() }).where(eq(ahConnections.householdId, householdId));
  return { imported: fresh.length, linesMapped, linesUnmapped };
}

export type PurchaseStat = { webshopId: number; times: number; units: number; lastBoughtAt: Date | null };

/** How often each webshop product was bought, most often first. */
export async function getPurchaseStats(householdId: string, opts: { sinceDays?: number } = {}): Promise<Map<number, PurchaseStat>> {
  const since = opts.sinceDays ? new Date(Date.now() - opts.sinceDays * 86_400_000) : null;
  const rows = await db
    .select({
      webshopId: ahReceiptLines.webshopId,
      times: sql<number>`count(distinct ${ahReceiptLines.receiptId})`,
      units: sql<number>`coalesce(sum(${ahReceiptLines.quantity}), 0)`,
      last: sql<Date | null>`max(${ahReceipts.boughtAt})`,
    })
    .from(ahReceiptLines)
    .innerJoin(ahReceipts, eq(ahReceiptLines.receiptId, ahReceipts.id))
    .where(
      and(
        eq(ahReceiptLines.householdId, householdId),
        sql`${ahReceiptLines.webshopId} is not null`,
        since ? sql`${ahReceipts.boughtAt} >= ${since}` : sql`true`
      )
    )
    .groupBy(ahReceiptLines.webshopId)
    .orderBy(desc(sql`count(distinct ${ahReceiptLines.receiptId})`));
  const out = new Map<number, PurchaseStat>();
  for (const r of rows) {
    if (r.webshopId == null) continue;
    out.set(r.webshopId, {
      webshopId: r.webshopId,
      times: Number(r.times),
      units: Number(r.units),
      lastBoughtAt: r.last ? new Date(r.last) : null,
    });
  }
  return out;
}

export async function receiptCount(householdId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(ahReceipts).where(eq(ahReceipts.householdId, householdId));
  return Number(n);
}

/** Households whose receipts are imported: for the cron. */
export async function connectedHouseholdIds(): Promise<string[]> {
  const rows = await db.select({ id: ahConnections.householdId }).from(ahConnections).where(eq(ahConnections.needsReconnect, false));
  return rows.map((r) => r.id);
}

export async function purchaseStatsFor(householdId: string, ids: number[]): Promise<Map<number, PurchaseStat>> {
  if (ids.length === 0) return new Map();
  const all = await getPurchaseStats(householdId);
  const out = new Map<number, PurchaseStat>();
  for (const id of ids) {
    const s = all.get(id);
    if (s) out.set(id, s);
  }
  return out;
}

export { inArray };
