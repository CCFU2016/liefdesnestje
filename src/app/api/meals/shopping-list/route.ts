import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mealPlanEntries, recipes, todoLists, todos } from "@/lib/db/schema";
import { and, eq, ilike, inArray, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  aggregateIngredients,
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  type AggregateInput,
  type AggregatedIngredient,
} from "@/lib/claude";

export const maxDuration = 60;

const bodySchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1),
  preview: z.boolean().default(false),
  listId: z.string().uuid().optional(), // destination todo list (default: the "Groceries" list)
});

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    // Load entries + their recipes (only meals the user can see)
    const rows = await db
      .select({ entry: mealPlanEntries, recipe: recipes })
      .from(mealPlanEntries)
      .leftJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          inArray(mealPlanEntries.id, body.data.entryIds),
          eq(mealPlanEntries.householdId, ctx.householdId),
          isNull(mealPlanEntries.deletedAt)
        )
      );

    const withRecipes = rows.filter((r) => r.recipe && (r.recipe.ingredients as unknown[]).length > 0);
    if (withRecipes.length === 0) {
      return NextResponse.json(
        { error: "None of the selected meals have a recipe with ingredients." },
        { status: 400 }
      );
    }

    // Build aggregation input
    const groups: AggregateInput[] = withRecipes.map((r) => ({
      recipeTitle: r.recipe!.title,
      servings: r.entry.servings ?? r.recipe!.servings,
      recipeDefaultServings: r.recipe!.servings,
      ingredients: r.recipe!.ingredients as AggregateInput["ingredients"],
    }));

    let aggregated: { items: AggregatedIngredient[] };
    let fallback = false;
    try {
      aggregated = await aggregateIngredients(groups, ctx.userId);
    } catch (e) {
      if (e instanceof ClaudeNotConfiguredError || e instanceof ExtractionBudgetError) {
        // Don't fall back for configuration / budget — surface clearly.
        return NextResponse.json({ error: (e as Error).message }, { status: e instanceof ExtractionBudgetError ? 429 : 500 });
      }
      // Any other Claude error: fall back to flat list with a warning.
      console.error("aggregate failed, falling back", e);
      fallback = true;
      aggregated = { items: flatFallback(groups) };
    }

    // Preview only — return the items without writing to todos.
    if (body.data.preview) {
      return NextResponse.json({ items: aggregated.items, fallback });
    }

    // Resolve destination list.
    let destListId = body.data.listId;
    if (!destListId) {
      const groceries = (
        await db
          .select()
          .from(todoLists)
          .where(and(eq(todoLists.householdId, ctx.householdId), ilike(todoLists.name, "%grocer%")))
          .limit(1)
      )[0];
      if (groceries) destListId = groceries.id;
      else {
        // Fallback: first list in the household
        const anyList = (
          await db
            .select()
            .from(todoLists)
            .where(eq(todoLists.householdId, ctx.householdId))
            .orderBy(todoLists.sortOrder)
            .limit(1)
        )[0];
        if (!anyList) {
          return NextResponse.json({ error: "No todo list available to push into." }, { status: 400 });
        }
        destListId = anyList.id;
      }
    } else {
      // Verify list belongs to household
      const list = (await db.select().from(todoLists).where(eq(todoLists.id, destListId)).limit(1))[0];
      if (!list || list.householdId !== ctx.householdId) {
        return NextResponse.json({ error: "Invalid list" }, { status: 400 });
      }
    }

    // Insert one todo per aggregated item
    const inserted = await db
      .insert(todos)
      .values(
        aggregated.items.map((item) => ({
          listId: destListId!,
          authorId: ctx.userId,
          title: formatTodoTitle(item),
          notes: item.sourceRecipes.length > 0 ? `for: ${item.sourceRecipes.join(", ")}` : null,
          source: "meal-plan",
        }))
      )
      .returning();

    return NextResponse.json({
      items: aggregated.items,
      fallback,
      listId: destListId,
      insertedCount: inserted.length,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("shopping-list failed", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function formatTodoTitle(item: { name: string; totalAmount: string; unit: string | null }): string {
  const qty = [item.totalAmount, item.unit].filter(Boolean).join(" ").trim();
  return qty ? `${qty} ${item.name}` : item.name;
}

function flatFallback(groups: AggregateInput[]): AggregatedIngredient[] {
  const out: AggregatedIngredient[] = [];
  for (const g of groups) {
    for (const ing of g.ingredients) {
      out.push({
        name: ing.name,
        totalAmount: ing.quantity ?? "",
        unit: ing.unit ?? null,
        sourceRecipes: [g.recipeTitle],
      });
    }
  }
  return out;
}
