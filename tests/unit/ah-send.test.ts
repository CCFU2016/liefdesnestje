import { describe, expect, it } from "vitest";
import { formatEuro, normalizeItemKey, splitAmount, summarizeSelections } from "@/lib/ah/send-helpers";
import type { AhProduct } from "@/lib/ah/products";

describe("splitAmount", () => {
  it("separates a leading amount from the name", () => {
    expect(splitAmount("200 g kipfilet")).toEqual({ amount: "200 g", name: "kipfilet" });
    expect(splitAmount("3 uien")).toEqual({ amount: "3", name: "uien" });
    expect(splitAmount("1 tbsp + 15g butter")).toEqual({ amount: "1 tbsp + 15g", name: "butter" });
    expect(splitAmount("2x 400 g tomatenblokjes")).toEqual({ amount: "2x 400 g", name: "tomatenblokjes" });
    expect(splitAmount("½ bunch parsley")).toEqual({ amount: "½ bunch", name: "parsley" });
  });
  it("leaves names without an amount alone", () => {
    expect(splitAmount("olive oil")).toEqual({ amount: null, name: "olive oil" });
    expect(splitAmount("  eggs ")).toEqual({ amount: null, name: "eggs" });
  });
  it("does not eat a name that is only a number-looking word", () => {
    expect(splitAmount("7up")).toEqual({ amount: null, name: "7up" });
  });
});

describe("normalizeItemKey", () => {
  it("drops amounts, case, brackets and punctuation so the same item keys the same", () => {
    expect(normalizeItemKey("200 g Kipfilet")).toBe("kipfilet");
    expect(normalizeItemKey("500g kipfilet (biologisch)")).toBe("kipfilet");
    expect(normalizeItemKey("Kipfilet!")).toBe("kipfilet");
    expect(normalizeItemKey("verse   basilicum")).toBe("verse basilicum");
  });
  it("keeps hyphens and accents", () => {
    expect(normalizeItemKey("crème fraîche")).toBe("crème fraîche");
    expect(normalizeItemKey("2 zoet-zure augurken")).toBe("zoet-zure augurken");
  });
  it("caps the length", () => {
    expect(normalizeItemKey("a".repeat(300)).length).toBe(120);
  });
});

const product = (over: Partial<AhProduct>): AhProduct => ({
  id: 1,
  title: "x",
  brand: null,
  unitSize: null,
  price: 2.5,
  priceBeforeBonus: null,
  isBonus: false,
  bonusLabel: null,
  bonusEndDate: null,
  imageUrl: null,
  isOrderable: true,
  ...over,
});

describe("summarizeSelections", () => {
  it("adds up price × packs, counts bonus and text items", () => {
    const s = summarizeSelections([
      { product: product({ price: 2.5, isBonus: true }), packs: 2 },
      { product: product({ id: 2, price: 1.2 }), packs: 1 },
      { product: product({ id: 3, price: null }), packs: 1 },
      { product: null, packs: 1 },
    ]);
    expect(s).toEqual({ estimate: 6.2, priced: 2, bonusCount: 1, productCount: 3, textCount: 1 });
  });
  it("has no estimate when nothing has a price", () => {
    expect(summarizeSelections([{ product: null, packs: 1 }]).estimate).toBeNull();
  });
});

describe("formatEuro", () => {
  it("uses a comma and two decimals", () => {
    expect(formatEuro(6.2)).toBe("€6,20");
    expect(formatEuro(34.2)).toBe("€34,20");
  });
});
