import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapRecipe, mapSearch, parseAllerhandeId, pickRecipeImage } from "@/lib/ah/recipes";

// Fixtures are real anonymous GraphQL answers captured on 2026-09-11.
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "ah", name), "utf8"));

describe("parseAllerhandeId", () => {
  it("reads the id out of an Allerhande recipe URL", () => {
    expect(parseAllerhandeId("https://www.ah.nl/allerhande/recept/R-R1194128/semifreddo-met-kersen")).toBe(1194128);
    expect(parseAllerhandeId("https://ah.nl/allerhande/recept/R-R42")).toBe(42);
    expect(parseAllerhandeId("https://www.ah.nl/allerhande/recept/R-R1194128?utm=x")).toBe(1194128);
  });
  it("ignores other hosts and other AH pages", () => {
    expect(parseAllerhandeId("https://www.nytimes.com/cooking/R-R1194128")).toBeNull();
    expect(parseAllerhandeId("https://www.ah.nl/producten/product/wi123")).toBeNull();
    expect(parseAllerhandeId("https://evil-ah.nl/allerhande/recept/R-R1")).toBeNull();
    expect(parseAllerhandeId("not a url")).toBeNull();
  });
});

describe("mapSearch", () => {
  const out = mapSearch(fixture("recipe-search.json").data);
  it("maps summaries with combined minutes and a sensible image", () => {
    expect(out.total).toBeGreaterThan(2);
    expect(out.recipes).toHaveLength(2);
    const r = out.recipes[0];
    expect(r.minutes).toBe(70); // 30 cook + 40 oven
    expect(r.servings).toBe(4);
    expect(r.nutriScore).toBe("A");
    expect(r.rating).toBe(3);
    expect(r.imageUrl).toMatch(/^https:\/\//);
  });
  it("copes with an empty answer", () => {
    expect(mapSearch({ recipeSearchV2: null })).toEqual({ total: 0, recipes: [] });
  });
});

describe("mapRecipe", () => {
  const r = mapRecipe(fixture("recipe.json").data)!;
  it("produces what the recipe form takes", () => {
    expect(r.title).toBe("Semifreddo met kersen en bitterkoekjes");
    expect(r.servings).toBe(6);
    expect(r.cookTimeMinutes).toBe(15);
    expect(r.prepTimeMinutes).toBeNull();
    expect(r.description).toContain("Wachttijd: 4 uur.");
    expect(r.sourceUrl).toBe("https://www.ah.nl/allerhande/recept/R-R1194128/semifreddo-met-kersen-en-bitterkoekjes");
    expect(r.instructions.length).toBeGreaterThan(3);
    expect(r.instructions[0]).toBe("Ontpit de kersen en halveer ze.");
  });
  it("splits ingredients into quantity, unit and name", () => {
    expect(r.ingredients[0]).toEqual({ quantity: "500", unit: "g", name: "kersen", notes: null });
    expect(r.ingredients.find((i) => i.name === "maizena")).toEqual({ quantity: "1", unit: "el", name: "maizena", notes: null });
  });
  it("carries nutrition in kcal and tags the recipe as allerhande", () => {
    expect(r.nutritionPerServing).toEqual({ calories: 375, protein: 7, carbs: 36, fat: 22, fiber: 2 });
    expect(r.tags).toContain("allerhande");
    expect(r.tags).toContain("italiaans");
  });
  it("returns null for a missing recipe", () => {
    expect(mapRecipe({ recipe: null })).toBeNull();
  });
});

describe("pickRecipeImage", () => {
  it("prefers the largest image at most 1000px wide", () => {
    expect(pickRecipeImage([{ url: "s", width: 220 }, { url: "m", width: 680 }, { url: "xl", width: 1600 }])).toBe("m");
    expect(pickRecipeImage([{ url: "xl", width: 1600 }])).toBe("xl");
    expect(pickRecipeImage(null)).toBeNull();
  });
});
