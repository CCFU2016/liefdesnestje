import { z } from "zod";
import { getAnonymousToken } from "./auth";
import { AhApiError, ahGraphql } from "./client";

// Allerhande recipes through AH's GraphQL. Anonymous: no member token.
// Verified 2026-09-11 (fixtures in tests/unit/fixtures/ah/recipe*.json).

export type AllerhandeSummary = {
  id: number;
  title: string;
  /** cook + oven minutes, when known */
  minutes: number | null;
  servings: number | null;
  imageUrl: string | null;
  nutriScore: string | null;
  rating: number | null;
};

/** What the recipe form expects; matches RecipeFormValue minus score/visibility. */
export type ImportedRecipe = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  ingredients: Array<{ quantity: string | null; unit: string | null; name: string; notes: string | null }>;
  instructions: string[];
  tags: string[];
  nutritionPerServing: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null } | null;
  sourceUrl: string | null;
  imageUrl: string | null;
};

const AH_SITE = "https://www.ah.nl";

/** The numeric id from an Allerhande URL like ah.nl/allerhande/recept/R-R1194128/…, or null. */
export function parseAllerhandeId(url: string): number | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "ah.nl" && !host.endsWith(".ah.nl")) return null;
  const m = u.pathname.match(/\/allerhande\/recept\/R-R(\d{1,12})(?:\/|$)/i);
  return m ? Number(m[1]) : null;
}

const Image = z.object({ url: z.string().max(2048), width: z.number().nullish(), height: z.number().nullish() }).passthrough();

const SummarySchema = z
  .object({
    id: z.number().int(),
    title: z.string().max(500),
    time: z.object({ cook: z.number().nullish(), oven: z.number().nullish(), wait: z.number().nullish() }).passthrough().nullish(),
    serving: z.object({ number: z.number().nullish() }).passthrough().nullish(),
    images: z.array(Image).nullish(),
    nutriScore: z.string().max(5).nullish(),
    rating: z.object({ average: z.number().nullish(), count: z.number().nullish() }).passthrough().nullish(),
  })
  .passthrough();

const SearchDataSchema = z.object({
  recipeSearchV2: z
    .object({
      page: z.object({ total: z.number().nullish() }).passthrough().nullish(),
      result: z.array(z.unknown()).nullish(),
    })
    .passthrough()
    .nullable(),
});

const Name = z.object({ singular: z.string().max(200).nullish(), plural: z.string().max(200).nullish() }).passthrough().nullish();
const Nutrient = z.object({ value: z.number().nullish(), unit: z.string().max(10).nullish() }).passthrough().nullish();

const RecipeSchema = z
  .object({
    id: z.number().int(),
    title: z.string().max(500),
    description: z.string().max(5000).nullish(),
    href: z.string().max(1000).nullish(),
    cookTime: z.number().nullish(),
    ovenTime: z.number().nullish(),
    waitTime: z.number().nullish(),
    servings: z.object({ number: z.number().nullish() }).passthrough().nullish(),
    ingredients: z
      .array(
        z
          .object({
            name: Name,
            quantity: z.number().nullish(),
            quantityUnit: Name,
            text: z.string().max(500).nullish(),
          })
          .passthrough()
      )
      .nullish(),
    preparation: z.object({ steps: z.array(z.string().max(5000)).nullish() }).passthrough().nullish(),
    images: z.array(Image).nullish(),
    tags: z.array(z.object({ key: z.string().max(100).nullish(), value: z.string().max(200).nullish() }).passthrough()).nullish(),
    nutritions: z
      .object({ energy: Nutrient, carbohydrates: Nutrient, protein: Nutrient, fat: Nutrient, fibers: Nutrient })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const RecipeDataSchema = z.object({ recipe: z.unknown().nullable() });

/** The largest image at most 1000px wide, else the largest there is. */
export function pickRecipeImage(images: Array<{ url: string; width?: number | null }> | null | undefined): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) <= 1000) ?? sorted[sorted.length - 1]).url;
}

export function mapSummary(raw: unknown): AllerhandeSummary | null {
  const r = SummarySchema.safeParse(raw);
  if (!r.success) return null;
  const s = r.data;
  const minutes = (s.time?.cook ?? 0) + (s.time?.oven ?? 0);
  return {
    id: s.id,
    title: s.title,
    minutes: minutes > 0 ? minutes : null,
    servings: s.serving?.number ?? null,
    imageUrl: pickRecipeImage(s.images),
    nutriScore: s.nutriScore ?? null,
    rating: s.rating?.average ?? null,
  };
}

export function mapSearch(data: unknown): { total: number; recipes: AllerhandeSummary[] } {
  const parsed = SearchDataSchema.parse(data);
  const recipes = (parsed.recipeSearchV2?.result ?? []).map(mapSummary).filter((s): s is AllerhandeSummary => s !== null);
  return { total: parsed.recipeSearchV2?.page?.total ?? recipes.length, recipes };
}

function formatQuantity(q: number | null | undefined): string | null {
  if (q == null || q <= 0) return null;
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
}

/** Maps a full Allerhande recipe to what our recipe form saves. */
export function mapRecipe(data: unknown): ImportedRecipe | null {
  const outer = RecipeDataSchema.parse(data);
  if (!outer.recipe) return null;
  const r = RecipeSchema.parse(outer.recipe);
  const cook = (r.cookTime ?? 0) + (r.ovenTime ?? 0);
  const n = r.nutritions;
  const kcal = n?.energy?.value != null ? (n.energy.unit?.toLowerCase() === "kj" ? n.energy.value / 4.184 : n.energy.value) : null;
  const tags = new Set<string>();
  for (const t of r.tags ?? []) {
    const v = t.value?.trim().toLowerCase();
    if (v) tags.add(v);
  }
  tags.add("allerhande");
  // Allerhande has no prep time; its "wait" (rising, marinating, freezing)
  // would mislead as prep, so it goes into the description as a note.
  const wait = r.waitTime && r.waitTime > 0 ? Math.round(r.waitTime) : null;
  const waitNote = wait ? `Wachttijd: ${wait >= 60 && wait % 60 === 0 ? `${wait / 60} uur` : `${wait} min`}.` : null;
  const description = [r.description?.trim() || null, waitNote].filter(Boolean).join(" ") || null;
  return {
    title: r.title,
    description,
    servings: r.servings?.number && r.servings.number > 0 ? Math.round(r.servings.number) : 2,
    prepTimeMinutes: null,
    cookTimeMinutes: cook > 0 ? Math.round(cook) : null,
    ingredients: (r.ingredients ?? [])
      .map((i) => ({
        quantity: formatQuantity(i.quantity),
        unit: i.quantityUnit?.singular?.trim() || null,
        name: i.name?.singular?.trim() || i.text?.trim() || "",
        notes: null,
      }))
      .filter((i) => i.name.length > 0),
    instructions: (r.preparation?.steps ?? []).map((s) => s.trim()).filter(Boolean),
    tags: Array.from(tags).slice(0, 10),
    nutritionPerServing: n
      ? {
          calories: kcal != null ? Math.round(kcal) : null,
          protein: n.protein?.value ?? null,
          carbs: n.carbohydrates?.value ?? null,
          fat: n.fat?.value ?? null,
          fiber: n.fibers?.value ?? null,
        }
      : null,
    sourceUrl: r.href ? AH_SITE + r.href : `${AH_SITE}/allerhande/recept/R-R${r.id}`,
    imageUrl: pickRecipeImage(r.images),
  };
}

// `size` and `id` are custom scalar types on AH's side (PageSize etc.), so
// they are inlined as validated integers instead of declared as variables.
const searchQuery = (size: number) => `query SearchRecipes($searchText: String!) {
  recipeSearchV2(searchText: $searchText, size: ${size}) {
    page { total }
    result { id title time { cook oven wait } serving { number } images { url width height } nutriScore rating { average count } }
  }
}`;

const recipeQuery = (id: number) => `query FetchRecipe {
  recipe(id: ${id}) {
    id title description href cookTime ovenTime waitTime
    servings { number }
    ingredients { name { singular plural } quantity quantityUnit { singular plural } text }
    preparation { steps summary }
    images { url width height }
    tags { key value }
    nutritions { energy { value unit } carbohydrates { value unit } protein { value unit } fat { value unit } fibers { value unit } }
  }
}`;

export async function searchRecipes(searchText: string, size = 12): Promise<{ total: number; recipes: AllerhandeSummary[] }> {
  const token = await getAnonymousToken();
  const safeSize = Math.min(Math.max(Math.floor(size) || 1, 1), 30);
  const data = await ahGraphql(token, searchQuery(safeSize), { searchText: searchText.slice(0, 200) });
  return mapSearch(data);
}

export async function getRecipe(id: number): Promise<ImportedRecipe | null> {
  const token = await getAnonymousToken();
  if (!Number.isInteger(id) || id <= 0 || id > 999_999_999_999) return null;
  try {
    const data = await ahGraphql(token, recipeQuery(id));
    return mapRecipe(data);
  } catch (e) {
    // An unknown id comes back as a GraphQL-level error on a 200, not as
    // `recipe: null`; that is "not found", not an outage.
    if (e instanceof AhApiError && e.status === 200) return null;
    throw e;
  }
}
