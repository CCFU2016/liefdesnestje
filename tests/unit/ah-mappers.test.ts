import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapProduct, mapSearchResponse, pickImage } from "@/lib/ah/products";
import { mapList } from "@/lib/ah/lists";
import { mapReceipt, mapReceiptsPage } from "@/lib/ah/receipts";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "ah", name), "utf8"));

describe("product mappers", () => {
  const search = mapSearchResponse(fixture("product-search.json"));

  it("keeps the total and drops products it cannot read", () => {
    expect(search.total).toBe(295);
    expect(search.products.map((p) => p.id)).toEqual([123456, 654321]);
  });

  it("maps a bonus product with its label and the 200px image", () => {
    const p = search.products[0];
    expect(p).toMatchObject({
      title: "AH Kipfilet",
      brand: "AH",
      unitSize: "2 stuks",
      price: 7.35,
      priceBeforeBonus: 7.58,
      isBonus: true,
      bonusLabel: "3% volume voordeel",
      bonusEndDate: "2999-12-31",
      imageUrl: "https://static.ah.nl/dam/product/A_200",
      isOrderable: true,
    });
  });

  it("falls back to the list price and hides bonus fields when not in bonus", () => {
    const p = search.products[1];
    expect(p.price).toBe(5.99);
    expect(p.isBonus).toBe(false);
    expect(p.bonusLabel).toBeNull();
    expect(p.isOrderable).toBe(false);
    // only an 80px image: take the largest available
    expect(p.imageUrl).toBe("https://static.ah.nl/dam/product/B_80");
  });

  it("tolerates unknown fields and rejects missing required ones", () => {
    expect(mapProduct({ webshopId: 1, title: "x", brandNew: "field" })?.id).toBe(1);
    expect(mapProduct({ title: "no id" })).toBeNull();
  });

  it("pickImage prefers the smallest image of at least 200px", () => {
    expect(pickImage([{ url: "big", width: 800 }, { url: "mid", width: 400 }, { url: "small", width: 100 }])).toBe("mid");
    expect(pickImage([])).toBeNull();
    expect(pickImage(null)).toBeNull();
  });
});

describe("list mapper", () => {
  const list = mapList(fixture("my-list.json"));

  it("maps product and free-text items and drops unreadable ones", () => {
    expect(list.id).toBe(987);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({
      listItemId: 1001,
      quantity: 2,
      kind: "product",
      description: "AH Kipfilet",
      checked: false,
    });
    expect(list.items[0].product?.id).toBe(123456);
    expect(list.items[1]).toMatchObject({
      listItemId: 1002,
      kind: "text",
      description: "verse basilicum",
      product: null,
      checked: true,
    });
  });
});

describe("receipt mappers", () => {
  const f = fixture("receipts.json");

  it("maps the receipts page, tolerating a missing total", () => {
    expect(mapReceiptsPage(f.page)).toEqual([
      { id: "R-1", dateTime: "2026-09-10T17:42:00", total: 43.21 },
      { id: "R-2", dateTime: "2026-09-07T12:05:00", total: null },
    ]);
    expect(mapReceiptsPage(f.empty)).toEqual([]);
  });

  it("maps receipt details with lines, discounts and payments", () => {
    const r = mapReceipt(f.details);
    expect(r?.total).toBe(43.21);
    expect(r?.lines).toEqual([
      { productId: "12", name: "AH KIPFILET", quantity: 2, price: 7.35, amount: 14.7, bonusKind: "bonusDiscount" },
      { productId: null, name: "STATIEGELD", quantity: 1, price: null, amount: 0.25, bonusKind: null },
    ]);
    expect(r?.discounts).toEqual([{ name: "BONUS", amount: -0.46 }]);
    expect(r?.payments).toEqual([{ method: "PIN", amount: 43.21 }]);
    expect(mapReceipt({ posReceiptDetails: null })).toBeNull();
  });
});
