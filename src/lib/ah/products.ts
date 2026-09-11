import { z } from "zod";
import { getAnonymousToken } from "./auth";
import { ahFetch } from "./client";
import { AH_PATHS } from "./constants";

// Product search and lookup. Anonymous: no member token needed.

export type AhProduct = {
  /** AH's `webshopId`; the id every other AH call wants. */
  id: number;
  title: string;
  brand: string | null;
  /** "500 g", "2 stuks", "1 l" */
  unitSize: string | null;
  /** What it costs now (bonus applied when in bonus). */
  price: number | null;
  priceBeforeBonus: number | null;
  isBonus: boolean;
  /** AH's own wording: "2 VOOR 5.50", "25% korting", "2e halve prijs" */
  bonusLabel: string | null;
  bonusEndDate: string | null;
  imageUrl: string | null;
  isOrderable: boolean;
};

const ImageSchema = z.object({ url: z.string().max(2048), width: z.number().optional(), height: z.number().optional() }).passthrough();

const RawProductSchema = z
  .object({
    webshopId: z.number().int(),
    title: z.string().max(500),
    brand: z.string().max(200).nullish(),
    salesUnitSize: z.string().max(100).nullish(),
    currentPrice: z.number().nullish(),
    priceBeforeBonus: z.number().nullish(),
    isBonus: z.boolean().nullish(),
    bonusMechanism: z.string().max(200).nullish(),
    bonusEndDate: z.string().max(20).nullish(),
    images: z.array(ImageSchema).nullish(),
    isOrderable: z.boolean().nullish(),
  })
  .passthrough();

const SearchResponseSchema = z
  .object({
    products: z.array(z.unknown()),
    page: z.object({ totalElements: z.number().optional() }).passthrough().optional(),
  })
  .passthrough();

const ProductsByIdsSchema = z.union([
  z.array(z.unknown()),
  z.object({ products: z.array(z.unknown()) }).passthrough(),
]);

/** Picks the smallest image that is still at least 200px wide. */
export function pickImage(images: Array<{ url: string; width?: number }> | null | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= 200) ?? sorted[sorted.length - 1]).url;
}

/** Maps one raw AH product to ours; returns null for a shape we don't know. */
export function mapProduct(raw: unknown): AhProduct | null {
  const r = RawProductSchema.safeParse(raw);
  if (!r.success) return null;
  const p = r.data;
  const isBonus = p.isBonus === true;
  return {
    id: p.webshopId,
    title: p.title,
    brand: p.brand ?? null,
    unitSize: p.salesUnitSize ?? null,
    price: p.currentPrice ?? p.priceBeforeBonus ?? null,
    priceBeforeBonus: p.priceBeforeBonus ?? null,
    isBonus,
    bonusLabel: isBonus ? (p.bonusMechanism ?? null) : null,
    bonusEndDate: isBonus ? (p.bonusEndDate ?? null) : null,
    imageUrl: pickImage(p.images),
    isOrderable: p.isOrderable !== false,
  };
}

export function mapSearchResponse(json: unknown): { products: AhProduct[]; total: number } {
  const parsed = SearchResponseSchema.parse(json);
  const products = parsed.products.map(mapProduct).filter((p): p is AhProduct => p !== null);
  return { products, total: parsed.page?.totalElements ?? products.length };
}

export function mapProductsByIdsResponse(json: unknown): AhProduct[] {
  const parsed = ProductsByIdsSchema.parse(json);
  const list = Array.isArray(parsed) ? parsed : parsed.products;
  return list.map(mapProduct).filter((p): p is AhProduct => p !== null);
}

export async function searchProducts(
  query: string,
  opts: { size?: number; token?: string } = {}
): Promise<{ products: AhProduct[]; total: number }> {
  const token = opts.token ?? (await getAnonymousToken());
  const params = new URLSearchParams({
    query: query.slice(0, 200),
    sortOn: "RELEVANCE",
    size: String(Math.min(Math.max(opts.size ?? 5, 1), 30)),
  });
  const { json } = await ahFetch(`${AH_PATHS.productSearch}?${params}`, { token });
  return mapSearchResponse(json);
}

/** Up to 50 ids per call; bonus flags come back fresh. */
export async function getProductsByIds(ids: number[], opts: { token?: string } = {}): Promise<AhProduct[]> {
  if (ids.length === 0) return [];
  const token = opts.token ?? (await getAnonymousToken());
  const out: AhProduct[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { json } = await ahFetch(`${AH_PATHS.productsByIds}?ids=${batch.join(",")}`, { token });
    out.push(...mapProductsByIdsResponse(json));
  }
  return out;
}
