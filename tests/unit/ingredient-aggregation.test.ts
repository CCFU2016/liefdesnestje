import { describe, it, expect, vi, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// Stub the DB before importing modules that touch it (rate-limit, claude index).
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ value: 0 }]),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve({ rowCount: 1 }),
    }),
  },
}));

// Mock the SDK so we don't hit the network.
const mockParse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse: mockParse };
  },
}));
vi.mock("@anthropic-ai/sdk/helpers/zod", () => ({
  zodOutputFormat: (s: unknown) => ({ type: "zod", schema: s }),
}));

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
});

describe("aggregateIngredients", () => {
  it("passes recipe groups to Claude and returns the parsed output", async () => {
    const fixture = {
      items: [
        { name: "onions", totalAmount: "3", unit: null, sourceRecipes: ["Pasta al pomodoro", "Chili con carne"] },
        { name: "garlic", totalAmount: "5", unit: "cloves", sourceRecipes: ["Pasta al pomodoro", "Chili con carne"] },
        { name: "butter", totalAmount: "115g", unit: "g", sourceRecipes: ["Pasta al pomodoro"] },
      ],
    };
    mockParse.mockResolvedValueOnce({ parsed_output: fixture });

    const { aggregateIngredients } = await import("@/lib/claude");

    const result = await aggregateIngredients(
      [
        {
          recipeTitle: "Pasta al pomodoro",
          servings: 2,
          recipeDefaultServings: 2,
          ingredients: [
            { quantity: "1", unit: null, name: "onion" },
            { quantity: "3", unit: "cloves", name: "garlic" },
            { quantity: "100", unit: "g", name: "butter" },
            { quantity: "1", unit: "tbsp", name: "butter" },
          ],
        },
        {
          recipeTitle: "Chili con carne",
          servings: 4,
          recipeDefaultServings: 4,
          ingredients: [
            { quantity: "2", unit: null, name: "onions" },
            { quantity: "2", unit: "cloves", name: "garlic" },
          ],
        },
      ],
      "user-123"
    );

    expect(mockParse).toHaveBeenCalledOnce();
    expect(result.items).toHaveLength(3);
    const onions = result.items.find((i) => i.name === "onions");
    expect(onions?.totalAmount).toBe("3");
    expect(onions?.sourceRecipes).toEqual(["Pasta al pomodoro", "Chili con carne"]);
  });

  it("surfaces the Claude call's null output as an error", async () => {
    mockParse.mockResolvedValueOnce({ parsed_output: null });
    const { aggregateIngredients } = await import("@/lib/claude");
    await expect(
      aggregateIngredients(
        [
          {
            recipeTitle: "X",
            servings: 1,
            recipeDefaultServings: 1,
            ingredients: [{ quantity: "1", unit: null, name: "thing" }],
          },
        ],
        "user-456"
      )
    ).rejects.toThrow(/no parsed output/);
  });
});
