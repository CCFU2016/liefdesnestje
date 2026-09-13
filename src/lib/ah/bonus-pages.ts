import { z } from "zod";
import { ahFetch, ahGraphql } from "./client";
import { mapProduct, type AhProduct } from "./products";

// The bonus pages of the AH app: bonus weeks, the personal Bonus Box, the
// "bonus for products you bought before" section, and the id bridge from
// till receipts to webshop products. Member token for everything here.
// Verified 2026-09-13 (docs/albert-heijn-api.md).

export type BonusPeriod = { start: string; end: string };

const MetadataSchema = z
  .object({
    periods: z.array(z.object({ bonusStartDate: z.string().max(10), bonusEndDate: z.string().max(10) }).passthrough()),
  })
  .passthrough();

/** Current and upcoming bonus weeks, oldest first. */
export async function getBonusPeriods(token: string): Promise<BonusPeriod[]> {
  const { json } = await ahFetch("/mobile-services/bonuspage/v3/metadata?application=AHWEBSHOP", { token });
  return MetadataSchema.parse(json).periods.map((p) => ({ start: p.bonusStartDate, end: p.bonusEndDate }));
}

export function periodFor(periods: BonusPeriod[], ymd: string): BonusPeriod | null {
  return periods.find((p) => p.start <= ymd && ymd <= p.end) ?? null;
}

// --- personal Bonus Box ----------------------------------------------------

export type PersonalSegment = {
  id: string;
  title: string;
  activated: boolean;
  productCount: number;
};

const PromotionSchema = z
  .object({
    id: z.string().max(50),
    title: z.string().max(300).nullish(),
    promotionType: z.string().max(30).nullish(),
    activationStatus: z.string().max(30).nullish(),
    productCount: z.number().int().nullish(),
  })
  .passthrough();

const PromotionsDataSchema = z.object({ bonusPromotions: z.array(z.unknown()).nullable() });

const SEGMENTS_QUERY = `query PersonalSegments($start: String, $end: String) {
  bonusPromotions(input: { periodStart: $start, periodEnd: $end, showAllPromotionSegments: true, forcePromotionVisibility: true, filterUnavailableProducts: false }) {
    id title promotionType activationStatus productCount
  }
}`;

export function mapPersonalSegments(data: unknown): PersonalSegment[] {
  const parsed = PromotionsDataSchema.parse(data);
  const out: PersonalSegment[] = [];
  for (const raw of parsed.bonusPromotions ?? []) {
    const r = PromotionSchema.safeParse(raw);
    if (!r.success || r.data.promotionType !== "PERSONAL") continue;
    out.push({
      id: r.data.id,
      title: r.data.title ?? "",
      activated: r.data.activationStatus === "ACTIVATED",
      productCount: r.data.productCount ?? 0,
    });
  }
  return out;
}

/** Every personal (Bonus Box) segment of a bonus week, activated or not. */
export async function getPersonalSegments(token: string, period: BonusPeriod): Promise<PersonalSegment[]> {
  const data = await ahGraphql(token, SEGMENTS_QUERY, { start: period.start, end: period.end });
  return mapPersonalSegments(data);
}

export type SegmentProduct = {
  id: number;
  title: string;
  now: number | null;
  was: number | null;
  label: string | null;
  imageUrl: string | null;
};

const SegmentProductsSchema = z.object({
  bonusPromotions: z
    .array(
      z
        .object({
          id: z.string().max(50),
          products: z
            .array(
              z
                .object({
                  id: z.number().int(),
                  title: z.string().max(300),
                  priceV2: z
                    .object({
                      now: z.object({ amount: z.number().nullish() }).passthrough().nullish(),
                      was: z.object({ amount: z.number().nullish() }).passthrough().nullish(),
                      promotionLabel: z
                        .object({ tiers: z.array(z.object({ description: z.string().max(200).nullish() }).passthrough()).nullish() })
                        .passthrough()
                        .nullish(),
                    })
                    .passthrough()
                    .nullish(),
                  imagePack: z.array(z.object({ medium: z.object({ url: z.string().max(2048) }).passthrough().nullish() }).passthrough()).nullish(),
                })
                .passthrough()
            )
            .nullish(),
        })
        .passthrough()
    )
    .nullable(),
});

const SEGMENT_PRODUCTS_QUERY = `query SegmentProducts($id: String, $start: String, $end: String) {
  bonusPromotions(input: { id: $id, periodStart: $start, periodEnd: $end, showAllPromotionSegments: true, forcePromotionVisibility: true }) {
    id
    products {
      id title
      priceV2(periodStart: $start, periodEnd: $end, forcePromotionVisibility: true) { now { amount } was { amount } promotionLabel { tiers { description } } }
      imagePack { medium { url } }
    }
  }
}`;

export function mapSegmentProducts(data: unknown): SegmentProduct[] {
  const parsed = SegmentProductsSchema.parse(data);
  const seg = parsed.bonusPromotions?.[0];
  return (seg?.products ?? []).map((p) => ({
    id: p.id,
    title: p.title,
    now: p.priceV2?.now?.amount ?? null,
    was: p.priceV2?.was?.amount ?? null,
    label: p.priceV2?.promotionLabel?.tiers?.[0]?.description ?? null,
    imageUrl: p.imagePack?.[0]?.medium?.url ?? null,
  }));
}

export async function getSegmentProducts(token: string, segmentId: string, period: BonusPeriod): Promise<SegmentProduct[]> {
  const data = await ahGraphql(token, SEGMENT_PRODUCTS_QUERY, { id: segmentId, start: period.start, end: period.end });
  return mapSegmentProducts(data);
}

const ActivateSchema = z.object({
  bonusActivatePersonalPromotion: z.object({ status: z.string().max(50).nullish(), message: z.string().max(200).nullish() }).passthrough().nullable(),
});

const ACTIVATE_MUTATION = `mutation ActivatePersonal($externalId: Int!, $startDate: String!) {
  bonusActivatePersonalPromotion(externalId: $externalId, startDate: $startDate) { status message }
}`;

/**
 * Activates a Bonus Box offer. AH's answer carries a status string; the
 * caller re-reads the segments to confirm rather than trusting it.
 */
export async function activatePersonalPromotion(token: string, segmentId: string, periodStart: string): Promise<{ status: string | null; message: string | null }> {
  const externalId = Number(segmentId);
  if (!Number.isInteger(externalId)) return { status: "SKIPPED", message: "segment id is not numeric" };
  const data = await ahGraphql(token, ACTIVATE_MUTATION, { externalId, startDate: periodStart });
  const parsed = ActivateSchema.parse(data);
  return { status: parsed.bonusActivatePersonalPromotion?.status ?? null, message: parsed.bonusActivatePersonalPromotion?.message ?? null };
}

// --- "bonus for products you bought before" ---------------------------------

const SectionSchema = z
  .object({
    bonusGroupOrProducts: z.array(z.object({ product: z.unknown().nullish() }).passthrough()),
  })
  .passthrough();

export function mapPreviouslyBought(json: unknown): AhProduct[] {
  const parsed = SectionSchema.parse(json);
  return parsed.bonusGroupOrProducts
    .map((it) => (it.product ? mapProduct(it.product) : null))
    .filter((p): p is AhProduct => p !== null);
}

/** AH's own list of bonus products this member has bought before, for the week containing `date`. */
export async function getPreviouslyBoughtBonus(token: string, date: string): Promise<AhProduct[]> {
  const { json } = await ahFetch(`/mobile-services/bonuspage/v2/section/previously-bought?application=AHWEBSHOP&date=${encodeURIComponent(date)}`, { token });
  return mapPreviouslyBought(json);
}

// --- till id → webshop id --------------------------------------------------

const ConvertSchema = z.object({ productConvertId: z.number().int().nullable() });

/** Maps a receipt line's product id to the webshop id; null when AH has no mapping. */
export async function convertPosProductId(token: string, posId: number): Promise<number | null> {
  const data = await ahGraphql(token, `query Convert($id: Int!) { productConvertId(sourceId: $id) }`, { id: posId });
  const v = ConvertSchema.parse(data).productConvertId;
  return v == null || v <= 0 ? null : v;
}
