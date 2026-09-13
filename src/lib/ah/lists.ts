import { z } from "zod";
import { ahFetch } from "./client";
import { AH_PATHS } from "./constants";
import { mapProduct, type AhProduct } from "./products";

// Mijn lijst, the shopping list in the Appie app. Member token required.
// Add-only: AH exposes no working call to remove or tick an item, so those
// happen in the app itself (verified 2026-09-11, see docs/albert-heijn-api.md).

export type AhListItem = {
  listItemId: number;
  quantity: number;
  /** PRD = a product, TXT = free text */
  kind: "product" | "text";
  description: string | null;
  product: AhProduct | null;
  checked: boolean;
};

export type AhList = {
  id: string | number | null;
  items: AhListItem[];
};

const RawItemSchema = z
  .object({
    listItemId: z.number().int(),
    quantity: z.number().int().nullish(),
    originCode: z.string().max(10).nullish(),
    description: z.string().max(500).nullish(),
    strikedthrough: z.boolean().nullish(),
    productDetails: z.object({ product: z.unknown().optional() }).passthrough().nullish(),
  })
  .passthrough();

const RawListSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    items: z.array(z.unknown()),
  })
  .passthrough();

export function mapListItem(raw: unknown): AhListItem | null {
  const r = RawItemSchema.safeParse(raw);
  if (!r.success) return null;
  const i = r.data;
  const product = i.productDetails?.product ? mapProduct(i.productDetails.product) : null;
  return {
    listItemId: i.listItemId,
    quantity: Math.max(i.quantity ?? 1, 1),
    kind: i.originCode === "TXT" ? "text" : "product",
    description: i.description ?? product?.title ?? null,
    product,
    checked: i.strikedthrough === true,
  };
}

export function mapList(json: unknown): AhList {
  const parsed = RawListSchema.parse(json);
  return {
    id: parsed.id ?? null,
    items: parsed.items.map(mapListItem).filter((i): i is AhListItem => i !== null),
  };
}

export async function getMyList(token: string): Promise<AhList> {
  const { json } = await ahFetch(AH_PATHS.myList, { token });
  return mapList(json);
}

export type NewListItem = {
  /** Shown in the app. For a product AH shows its own title; the text is the search term. */
  description: string;
  quantity: number;
  /** AH `webshopId`; omit for a free-text line. */
  productId?: number;
};

/**
 * Appends items to Mijn lijst in one call. AH answers with the whole
 * updated list, which is returned so callers can show the new size.
 */
export async function addToMyList(token: string, items: NewListItem[]): Promise<AhList> {
  if (items.length === 0) return getMyList(token);
  const body = {
    items: items.map((it) => ({
      description: it.description.slice(0, 200),
      quantity: Math.max(1, Math.min(99, Math.round(it.quantity))),
      type: "SHOPPABLE",
      originCode: "PRD",
      strikeThrough: false,
      ...(it.productId ? { productId: it.productId, searchTerm: it.description.slice(0, 200) } : {}),
    })),
  };
  const { json } = await ahFetch(AH_PATHS.myList, { method: "PATCH", token, body });
  return mapList(json);
}
