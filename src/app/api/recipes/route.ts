import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recipes, recipeFavorites } from "@/lib/db/schema";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { estimateNutrition } from "@/lib/claude";

const ingredientSchema = z.object({
  quantity: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  name: z.string().min(1),
  notes: z.string().nullable().optional(),
});

const nutritionSchema = z.object({
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  fiber: z.number().nullable(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  servings: z.number().int().positive().default(2),
  prepTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  cookTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  ingredients: z.array(ingredientSchema).default([]),
  instructions: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  nutritionPerServing: nutritionSchema.nullable().optional(),
  sourceUrl: z.string().url().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  score: z.number().int().min(1).max(5).nullable().optional(),
  visibility: z.enum(["private", "shared"]).default("shared"),
});

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    const tag = url.searchParams.get("tag")?.trim();
    const favoritesOnly = url.searchParams.get("favorites") === "1";

    const base = and(
      eq(recipes.householdId, ctx.householdId),
      isNull(recipes.deletedAt),
      or(eq(recipes.visibility, "shared"), eq(recipes.authorId, ctx.userId))
    );

    const conditions = [base];
    if (q) conditions.push(ilike(recipes.title, `%${q}%`));
    if (tag) conditions.push(sql`${tag} = ANY(${recipes.tags})`);

    let rows = await db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        servings: recipes.servings,
        prepTimeMinutes: recipes.prepTimeMinutes,
        cookTimeMinutes: recipes.cookTimeMinutes,
        tags: recipes.tags,
        imageUrl: recipes.imageUrl,
        cookedCount: recipes.cookedCount,
        score: recipes.score,
        authorId: recipes.authorId,
        visibility: recipes.visibility,
        updatedAt: recipes.updatedAt,
      })
      .from(recipes)
      .where(and(...conditions))
      .orderBy(desc(recipes.updatedAt))
      .limit(200);

    // Fold in current user's favorites
    const favs = await db
      .select({ recipeId: recipeFavorites.recipeId })
      .from(recipeFavorites)
      .where(eq(recipeFavorites.userId, ctx.userId));
    const favSet = new Set(favs.map((f) => f.recipeId));

    const payload = rows.map((r) => ({ ...r, isFavorite: favSet.has(r.id) }));
    if (favoritesOnly) {
      return NextResponse.json({ recipes: payload.filter((r) => r.isFavorite) });
    }
    return NextResponse.json({ recipes: payload });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid input", details: body.error.issues }, { status: 400 });
    }

    const [created] = await db
      .insert(recipes)
      .values({
        householdId: ctx.householdId,
        authorId: ctx.userId,
        title: body.data.title,
        description: body.data.description ?? null,
        servings: body.data.servings,
        prepTimeMinutes: body.data.prepTimeMinutes ?? null,
        cookTimeMinutes: body.data.cookTimeMinutes ?? null,
        ingredients: body.data.ingredients,
        instructions: body.data.instructions,
        tags: body.data.tags,
        nutritionPerServing: body.data.nutritionPerServing ?? null,
        sourceUrl: body.data.sourceUrl ?? null,
        imageUrl: body.data.imageUrl ?? null,
        score: body.data.score ?? null,
        visibility: body.data.visibility,
      })
      .returning();

    // Auto-estimate nutrition when the incoming recipe has ingredients but
    // no macros (manual entries, or URL/image extractions where Claude
    // couldn't infer them). Fire-and-forget so the POST returns fast; the
    // recipe page picks up the updated row on its next SWR refresh.
    const hasRealMacros =
      !!created.nutritionPerServing &&
      Object.values(created.nutritionPerServing).some((v) => typeof v === "number");
    if (!hasRealMacros && body.data.ingredients.length > 0) {
      queueMicrotask(async () => {
        try {
          const nutrition = await estimateNutrition({
            recipeTitle: created.title,
            servings: created.servings,
            ingredients: body.data.ingredients.map((i) => ({
              quantity: i.quantity ?? null,
              unit: i.unit ?? null,
              name: i.name,
              notes: i.notes ?? null,
            })),
            userId: ctx.userId,
          });
          await db
            .update(recipes)
            .set({ nutritionPerServing: nutrition, updatedAt: new Date() })
            .where(eq(recipes.id, created.id));
        } catch (e) {
          console.warn(
            "[recipes] auto-estimate nutrition failed for",
            created.id,
            e instanceof Error ? e.message : String(e)
          );
        }
      });
    }

    return NextResponse.json({ recipe: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
