// Pure helpers for "Send to Albert Heijn"; unit-tested, no I/O.

import type { AhProduct } from "./products";

const UNIT_WORDS =
  "kg|g|gr|gram|grams|mg|ml|cl|dl|l|liter|liters|litre|tbsp|tsp|el|tl|cup|cups|stuks?|st|pcs?|pieces?|pack|packs|bunch|bunches|bos|bosjes?|teen|tenen|clove|cloves|blik|blikjes?|can|cans|pot|jar|zakje|bag|slices?|plakjes?|x";

// "200 g kipfilet", "3 uien", "1 tbsp + 15g butter", "2x 400 g tomatenblokjes"
// A number must be followed by a unit word or whitespace, so "7up" stays a name.
const LEADING_AMOUNT = new RegExp(
  `^\\s*(?:[\\d.,/½¼¾⅓⅔]+\\s*(?:(?:${UNIT_WORDS})\\b\\.?)?\\s+(?:\\+\\s*)?)+`,
  "i"
);

/** Splits "200 g kipfilet" into { amount: "200 g", name: "kipfilet" }. */
export function splitAmount(title: string): { amount: string | null; name: string } {
  const t = title.trim();
  const m = t.match(LEADING_AMOUNT);
  if (!m || m[0].trim().length === 0 || m[0].length >= t.length) return { amount: null, name: t };
  const amount = m[0].trim().replace(/\s+/g, " ");
  const name = t.slice(m[0].length).trim();
  return name ? { amount, name } : { amount: null, name: t };
}

/**
 * The key a household's remembered product match is stored under: the
 * item name without quantities, brackets or punctuation, lower-cased.
 */
export function normalizeItemKey(title: string): string {
  const { name } = splitAmount(title);
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export type ReviewedItem = { product: AhProduct | null; packs: number };

/** Footer numbers for the review sheet. */
export function summarizeSelections(items: ReviewedItem[]): {
  estimate: number | null;
  priced: number;
  bonusCount: number;
  productCount: number;
  textCount: number;
} {
  let estimate = 0;
  let priced = 0;
  let bonusCount = 0;
  let productCount = 0;
  let textCount = 0;
  for (const it of items) {
    if (!it.product) {
      textCount++;
      continue;
    }
    productCount++;
    if (it.product.isBonus) bonusCount++;
    if (it.product.price != null) {
      estimate += it.product.price * Math.max(1, it.packs);
      priced++;
    }
  }
  return { estimate: priced > 0 ? Math.round(estimate * 100) / 100 : null, priced, bonusCount, productCount, textCount };
}

export function formatEuro(n: number): string {
  return `€${n.toFixed(2).replace(".", ",")}`;
}
