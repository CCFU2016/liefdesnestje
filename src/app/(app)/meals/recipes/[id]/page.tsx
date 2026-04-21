import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { recipeFavorites, recipes } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { RecipeDetailClient } from "./client";

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireHouseholdMember();
  const r = (await db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
  if (!r || r.householdId !== ctx.householdId || r.deletedAt) notFound();
  if (r.visibility === "private" && r.authorId !== ctx.userId) notFound();

  const fav = (
    await db
      .select()
      .from(recipeFavorites)
      .where(and(eq(recipeFavorites.userId, ctx.userId), eq(recipeFavorites.recipeId, id)))
      .limit(1)
  )[0];

  return (
    <RecipeDetailClient
      recipe={{
        id: r.id,
        title: r.title,
        description: r.description,
        servings: r.servings,
        prepTimeMinutes: r.prepTimeMinutes,
        cookTimeMinutes: r.cookTimeMinutes,
        ingredients: r.ingredients as Array<{
          quantity: string | null;
          unit: string | null;
          name: string;
          notes: string | null;
        }>,
        instructions: r.instructions as string[],
        tags: r.tags,
        nutritionPerServing: r.nutritionPerServing as
          | { calories: number | null; protein: number | null; carbs: number | null; fat: number | null; fiber: number | null }
          | null,
        sourceUrl: r.sourceUrl,
        imageUrl: r.imageUrl,
        cookedCount: r.cookedCount,
        visibility: r.visibility,
        authorId: r.authorId,
      }}
      isFavorite={!!fav}
      canEdit={r.authorId === ctx.userId}
    />
  );
}
