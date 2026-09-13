import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapPersonalSegments, mapPreviouslyBought, mapSegmentProducts, periodFor } from "@/lib/ah/bonus-pages";
import { isProgrammeSegment, pickActivations, rankBonusThisWeek, scoreSegment, type SegmentCandidate } from "@/lib/ah/weekly-helpers";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "ah", name), "utf8"));

describe("bonus page mappers", () => {
  it("maps a personal segment with its products and labels", () => {
    const seg = fixture("personal-segment.json").data;
    const products = mapSegmentProducts(seg);
    expect(products).toHaveLength(3);
    expect(products[0]).toMatchObject({ id: 238912, title: "AH Biologisch Buffelmozzarella 52+", now: 2.23, was: 2.79, label: "20% korting" });
    expect(products[0].imageUrl).toMatch(/^https:\/\//);
  });

  it("keeps only PERSONAL promotions and reads the activation status", () => {
    const segments = mapPersonalSegments({
      bonusPromotions: [
        { id: "671729", title: "AH Biologische mozzarela", promotionType: "PERSONAL", activationStatus: "ACTIVATED", productCount: 3 },
        { id: "803465", title: "Bio Premium Stuks", promotionType: "PERSONAL", activationStatus: "NONE", productCount: 1287 },
        { id: "1", title: "AH Paprika", promotionType: "NATIONAL", activationStatus: "NONE", productCount: 2 },
      ],
    });
    expect(segments.map((s) => s.id)).toEqual(["671729", "803465"]);
    expect(segments[0].activated).toBe(true);
    expect(segments[1].activated).toBe(false);
  });

  it("maps the previously-bought section to products", () => {
    const products = mapPreviouslyBought(fixture("previously-bought.json"));
    expect(products.length).toBeGreaterThan(2);
    expect(products[0]).toMatchObject({ id: 4117, title: "AH Paprika rood", isBonus: true, bonusLabel: "1 + 1 GRATIS" });
  });

  it("finds the bonus week containing a date", () => {
    const periods = [{ start: "2026-09-07", end: "2026-09-13" }, { start: "2026-09-14", end: "2026-09-20" }];
    expect(periodFor(periods, "2026-09-13")).toEqual(periods[0]);
    expect(periodFor(periods, "2026-09-14")).toEqual(periods[1]);
    expect(periodFor(periods, "2026-10-01")).toBeNull();
  });
});

describe("Bonus Box picking", () => {
  const stats = new Map([
    [238912, { times: 40 }],
    [238911, { times: 52 }],
    [4117, { times: 35 }],
    [999, { times: 1 }],
  ]);
  const seg = (over: Partial<SegmentCandidate>): SegmentCandidate => ({ id: "1", title: "x", activated: false, productCount: 2, productIds: [], ...over });

  it("scores an offer by how often its products were bought", () => {
    expect(scoreSegment(seg({ productIds: [238912, 238911, 550417] }), stats)).toBe(92);
    expect(scoreSegment(seg({ productIds: [123] }), stats)).toBe(0);
  });

  it("treats the big programme segments as not-an-offer", () => {
    expect(isProgrammeSegment({ productCount: 1287 })).toBe(true);
    expect(isProgrammeSegment({ productCount: 5 })).toBe(false);
  });

  it("activates the best unactivated offers with enough history, within the remaining slots", () => {
    const picks = pickActivations(
      [
        seg({ id: "moz", title: "Mozzarella", productIds: [238912, 238911] }),
        seg({ id: "pap", title: "Paprika", productIds: [4117] }),
        seg({ id: "rare", title: "Rare thing", productIds: [999] }), // bought once: not enough
        seg({ id: "never", title: "Never bought", productIds: [5] }),
        seg({ id: "done", title: "Already on", activated: true, productIds: [4117] }),
        seg({ id: "prog", title: "Bio Premium Stuks", productCount: 1287, productIds: [] }),
      ],
      stats,
      { maxActivations: 3 }
    );
    expect(picks.map((p) => [p.id, p.score])).toEqual([
      ["moz", 92],
      ["pap", 35],
    ]);
  });

  it("activates nothing when the slots are used up", () => {
    const picks = pickActivations(
      [seg({ id: "a", activated: true }), seg({ id: "b", activated: true }), seg({ id: "c", productIds: [4117] })],
      stats,
      { maxActivations: 2 }
    );
    expect(picks).toEqual([]);
  });
});

describe("rankBonusThisWeek", () => {
  it("puts the products we buy most first, then the rest alphabetically", () => {
    const products = mapPreviouslyBought(fixture("previously-bought.json"));
    const ranked = rankBonusThisWeek(products, new Map([[177754, { times: 36 }], [4117, { times: 35 }]]));
    expect(ranked[0].id).toBe(177754);
    expect(ranked[1].id).toBe(4117);
    expect(ranked[2].times).toBe(0);
  });
});
