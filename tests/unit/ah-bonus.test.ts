import { describe, expect, it } from "vitest";
import { bonusTagsForNames } from "@/lib/ah/bonus";
import type { AhProduct } from "@/lib/ah/products";

const product = (over: Partial<AhProduct>): AhProduct => ({
  id: 1,
  title: "AH Kipfilet",
  brand: "AH",
  unitSize: "300 g",
  price: 3.5,
  priceBeforeBonus: 4.2,
  isBonus: true,
  bonusLabel: "2e halve prijs",
  bonusEndDate: "2026-09-13",
  imageUrl: null,
  isOrderable: true,
  ...over,
});

describe("bonusTagsForNames", () => {
  const matches = new Map([
    ["kipfilet", { ahProductId: 1 }],
    ["uien", { ahProductId: 2 }],
    ["melk", { ahProductId: 3 }],
  ]);
  const products = new Map<number, AhProduct | null>([
    [1, product({})],
    [2, product({ id: 2, title: "AH Uien", isBonus: false, bonusLabel: null })],
    [3, null], // looked up but AH no longer knows it
  ]);

  it("tags only remembered products that are in bonus, keyed by the given name", () => {
    const out = bonusTagsForNames(["200 g kipfilet", "3 uien", "melk", "olijfolie"], matches, products);
    expect(out).toEqual({
      "200 g kipfilet": { label: "2e halve prijs", endDate: "2026-09-13", productTitle: "AH Kipfilet" },
    });
  });

  it("falls back to a plain Bonus label", () => {
    const out = bonusTagsForNames(["kipfilet"], matches, new Map([[1, product({ bonusLabel: null })]]));
    expect(out.kipfilet.label).toBe("Bonus");
  });

  it("is empty with nothing remembered", () => {
    expect(bonusTagsForNames(["kipfilet"], new Map(), products)).toEqual({});
  });
});
