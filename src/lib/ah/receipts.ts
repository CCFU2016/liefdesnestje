import { z } from "zod";
import { ahGraphql } from "./client";

// In-store receipts (kassabonnen). Member token required. Read-only.

export type AhReceiptSummary = {
  id: string;
  dateTime: string;
  total: number | null;
};

export type AhReceiptLine = {
  /** The till's product id (not the webshop id; see productConvertId in bonus-pages.ts). */
  productId: string | null;
  name: string;
  quantity: number | null;
  /** Unit price */
  price: number | null;
  /** Line total */
  amount: number | null;
  /** Bought under a bonus ('bonusDiscount') or a personal Bonus Box offer ('bonusBox'). */
  bonusKind: "bonusDiscount" | "bonusBox" | null;
};

export type AhReceipt = {
  id: string;
  total: number | null;
  lines: AhReceiptLine[];
  discounts: Array<{ name: string; amount: number | null }>;
  payments: Array<{ method: string; amount: number | null }>;
};

const Money = z.object({ amount: z.number().nullish() }).passthrough().nullish();

const ReceiptsPageSchema = z.object({
  posReceiptsPage: z
    .object({
      posReceipts: z.array(
        z
          .object({ id: z.string().max(200), dateTime: z.string().max(64), totalAmount: Money })
          .passthrough()
      ),
    })
    .passthrough()
    .nullable(),
});

const ReceiptDetailsSchema = z.object({
  posReceiptDetails: z
    .object({
      id: z.string().max(200),
      total: Money,
      products: z
        .array(
          z
            .object({
              id: z.union([z.string(), z.number()]).nullish(),
              quantity: z.number().nullish(),
              name: z.string().max(500).nullish(),
              price: Money,
              amount: Money,
              indicators: z.array(z.object({ name: z.string().max(50).nullish() }).passthrough()).nullish(),
            })
            .passthrough()
        )
        .nullish(),
      discounts: z.array(z.object({ name: z.string().max(500).nullish(), amount: Money }).passthrough()).nullish(),
      payments: z.array(z.object({ method: z.string().max(100).nullish(), amount: Money }).passthrough()).nullish(),
    })
    .passthrough()
    .nullable(),
});

const LIST_QUERY = `query FetchPosReceipts($offset: Int!, $limit: Int!) {
  posReceiptsPage(pagination: { offset: $offset, limit: $limit }) {
    posReceipts { id dateTime totalAmount { amount } }
  }
}`;

const DETAILS_QUERY = `query FetchReceipt($id: String!) {
  posReceiptDetails(id: $id) {
    id total { amount }
    products { id quantity name price { amount } amount { amount } indicators { name } }
    discounts { name amount { amount } }
    payments { method amount { amount } }
  }
}`;

export function mapReceiptsPage(data: unknown): AhReceiptSummary[] {
  const parsed = ReceiptsPageSchema.parse(data);
  return (parsed.posReceiptsPage?.posReceipts ?? []).map((r) => ({
    id: r.id,
    dateTime: r.dateTime,
    total: r.totalAmount?.amount ?? null,
  }));
}

export function mapReceipt(data: unknown): AhReceipt | null {
  const parsed = ReceiptDetailsSchema.parse(data);
  const d = parsed.posReceiptDetails;
  if (!d) return null;
  return {
    id: d.id,
    total: d.total?.amount ?? null,
    lines: (d.products ?? []).map((p) => ({
      productId: p.id == null ? null : String(p.id),
      name: p.name ?? "",
      quantity: p.quantity ?? null,
      price: p.price?.amount ?? null,
      amount: p.amount?.amount ?? null,
      bonusKind: (p.indicators ?? []).some((i) => i.name === "bonusBox")
        ? "bonusBox"
        : (p.indicators ?? []).some((i) => i.name === "bonusDiscount")
          ? "bonusDiscount"
          : null,
    })),
    discounts: (d.discounts ?? []).map((x) => ({ name: x.name ?? "", amount: x.amount?.amount ?? null })),
    payments: (d.payments ?? []).map((x) => ({ method: x.method ?? "", amount: x.amount?.amount ?? null })),
  };
}

export async function listReceipts(token: string, offset = 0, limit = 20): Promise<AhReceiptSummary[]> {
  const data = await ahGraphql(token, LIST_QUERY, { offset, limit: Math.min(Math.max(limit, 1), 100) });
  return mapReceiptsPage(data);
}

export async function getReceipt(token: string, id: string): Promise<AhReceipt | null> {
  const data = await ahGraphql(token, DETAILS_QUERY, { id });
  return mapReceipt(data);
}
