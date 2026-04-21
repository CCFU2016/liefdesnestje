import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recipes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  estimateNutrition,
} from "@/lib/claude";

export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;

    const r = (await db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
    if (!r || r.householdId !== ctx.householdId || r.deletedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (r.visibility === "private" && r.authorId !== ctx.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ingredients = r.ingredients as Array<{
      quantity: string | null;
      unit: string | null;
      name: string;
      notes?: string | null;
    }>;
    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return NextResponse.json(
        { error: "No ingredients to estimate from." },
        { status: 400 }
      );
    }

    const nutrition = await estimateNutrition({
      recipeTitle: r.title,
      servings: r.servings,
      ingredients,
      userId: ctx.userId,
    });

    const [updated] = await db
      .update(recipes)
      .set({ nutritionPerServing: nutrition, updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();

    return NextResponse.json({ recipe: updated, nutrition });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof ClaudeNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    if (e instanceof ExtractionBudgetError) {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    console.error("estimate-nutrition failed", e);
    return NextResponse.json(
      { error: "Couldn't estimate macros — try again later." },
      { status: 500 }
    );
  }
}
