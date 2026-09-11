import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ahProductMatches, todoLists, todos } from "@/lib/db/schema";
import { matchGroceryTerms } from "@/lib/claude";
import { withAhConnection } from "./connection";
import { addToMyList, type NewListItem } from "./lists";
import { getProductsByIds, searchProducts, type AhProduct } from "./products";
import { normalizeItemKey, splitAmount } from "./send-helpers";

// "Send to Albert Heijn": grocery items → AH products (reviewed by a person)
// → Mijn lijst. Two halves: prepareSend finds candidates, sendToAh writes.

export type PreparedItem = {
  key: string;
  todoId: string | null;
  title: string;
  searchTerm: string;
  packs: number;
  note: string | null;
  /** The household chose this product for this item before. */
  remembered: boolean;
  candidates: AhProduct[];
  /** Preselected candidate, or null for "add as text". */
  selectedProductId: number | null;
};

export type PrepareInput = {
  householdId: string;
  userId: string;
  items: Array<{ todoId?: string | null; title: string }>;
};

const SEARCH_CONCURRENCY = 4;
const CANDIDATES_PER_ITEM = 3;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Finds AH product candidates for each item. Remembered matches skip
 * Claude and get their product refreshed by id; the rest go through one
 * batched Claude call for Dutch search terms, then a product search each.
 * Any Claude failure degrades to searching the plain item name.
 */
export async function prepareSend(input: PrepareInput): Promise<{ items: PreparedItem[]; usedClaude: boolean }> {
  const base = input.items.slice(0, 100).map((it) => {
    const { amount, name } = splitAmount(it.title);
    return { todoId: it.todoId ?? null, title: it.title, name, amount, key: normalizeItemKey(it.title) };
  });

  const keys = Array.from(new Set(base.map((b) => b.key)));
  const remembered = keys.length
    ? await db
        .select()
        .from(ahProductMatches)
        .where(and(eq(ahProductMatches.householdId, input.householdId), inArray(ahProductMatches.itemKey, keys)))
    : [];
  const rememberedByKey = new Map(remembered.map((r) => [r.itemKey, r]));

  // Fresh price and bonus for remembered products, in one call.
  const rememberedIds = Array.from(new Set(remembered.map((r) => r.ahProductId)));
  let productById = new Map<number, AhProduct>();
  if (rememberedIds.length) {
    try {
      productById = new Map((await getProductsByIds(rememberedIds)).map((p) => [p.id, p]));
    } catch {
      // fall through: these items are searched like new ones
    }
  }

  // Search terms for the rest, one Claude call; plain names if that fails.
  const needTerms = base.filter((b) => !(rememberedByKey.has(b.key) && productById.has(rememberedByKey.get(b.key)!.ahProductId)));
  const termByName = new Map<string, { searchTerm: string; packs: number; note: string | null }>();
  let usedClaude = false;
  if (needTerms.length) {
    try {
      const res = await matchGroceryTerms(
        needTerms.map((b) => ({ name: b.title, amount: b.amount })),
        input.userId
      );
      for (const t of res.items) termByName.set(t.name, { searchTerm: t.searchTerm, packs: t.packs, note: t.note });
      usedClaude = true;
    } catch (e) {
      console.warn("ah-match via Claude failed, using plain names:", e instanceof Error ? e.message : e);
    }
  }

  const items = await mapLimit(base, SEARCH_CONCURRENCY, async (b): Promise<PreparedItem> => {
    const mem = rememberedByKey.get(b.key);
    const memProduct = mem ? productById.get(mem.ahProductId) : undefined;
    if (mem && memProduct) {
      return {
        key: b.key,
        todoId: b.todoId,
        title: b.title,
        searchTerm: memProduct.title,
        packs: 1,
        note: null,
        remembered: true,
        candidates: [memProduct],
        selectedProductId: memProduct.id,
      };
    }
    const term = termByName.get(b.title) ?? { searchTerm: b.name, packs: 1, note: null };
    let candidates: AhProduct[] = [];
    try {
      const res = await searchProducts(term.searchTerm, { size: 5 });
      candidates = res.products.slice(0, CANDIDATES_PER_ITEM);
    } catch (e) {
      console.warn("ah product search failed:", e instanceof Error ? e.message : e);
    }
    return {
      key: b.key,
      todoId: b.todoId,
      title: b.title,
      searchTerm: term.searchTerm,
      packs: Math.min(Math.max(term.packs, 1), 20),
      note: term.note,
      remembered: false,
      candidates,
      selectedProductId: candidates[0]?.id ?? null,
    };
  });

  return { items, usedClaude };
}

export type Selection = {
  todoId?: string | null;
  key: string;
  title: string;
  packs: number;
  /** null = add as free text */
  productId: number | null;
  productTitle?: string | null;
  imageUrl?: string | null;
};

/**
 * Writes the reviewed selections to Mijn lijst in one call, remembers the
 * product choices, and stamps the to-dos as sent. Nothing here is undone
 * on failure: the AH call comes first, and only its success leads to writes.
 */
export async function sendToAh(input: { householdId: string; userId: string; selections: Selection[] }): Promise<{ sent: number; listSize: number }> {
  const selections = input.selections.slice(0, 100);
  if (selections.length === 0) return { sent: 0, listSize: 0 };

  const listItems: NewListItem[] = selections.map((s) => ({
    description: s.productId ? (s.productTitle?.trim() || s.title) : s.title,
    quantity: Math.min(Math.max(Math.round(s.packs) || 1, 1), 99),
    ...(s.productId ? { productId: s.productId } : {}),
  }));

  const list = await withAhConnection(input.householdId, (token) => addToMyList(token, listItems));

  const now = new Date();
  for (const s of selections) {
    if (!s.productId) continue;
    await db
      .insert(ahProductMatches)
      .values({
        householdId: input.householdId,
        itemKey: s.key,
        ahProductId: s.productId,
        title: (s.productTitle ?? s.title).slice(0, 500),
        imageUrl: s.imageUrl?.slice(0, 2048) ?? null,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [ahProductMatches.householdId, ahProductMatches.itemKey],
        set: {
          ahProductId: s.productId,
          title: (s.productTitle ?? s.title).slice(0, 500),
          imageUrl: s.imageUrl?.slice(0, 2048) ?? null,
          lastUsedAt: now,
        },
      });
  }

  const todoIds = selections.map((s) => s.todoId).filter((id): id is string => typeof id === "string");
  if (todoIds.length) {
    const householdListIds = db
      .select({ id: todoLists.id })
      .from(todoLists)
      .where(eq(todoLists.householdId, input.householdId));
    await db
      .update(todos)
      .set({ ahSentAt: now, updatedAt: now })
      .where(and(inArray(todos.id, todoIds), inArray(todos.listId, householdListIds)));
  }

  return { sent: selections.length, listSize: list.items.length };
}
