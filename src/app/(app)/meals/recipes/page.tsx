import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { recipeFavorites, recipes } from "@/lib/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { RecipesClient } from "./client";

export default async function RecipesPage() {
  const ctx = await requireHouseholdMember();

  const [rows, favs] = await Promise.all([
    db
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
      .where(
        and(
          eq(recipes.householdId, ctx.householdId),
          isNull(recipes.deletedAt),
          or(eq(recipes.visibility, "shared"), eq(recipes.authorId, ctx.userId))
        )
      )
      .orderBy(desc(recipes.updatedAt)),
    db.select({ recipeId: recipeFavorites.recipeId }).from(recipeFavorites).where(eq(recipeFavorites.userId, ctx.userId)),
  ]);

  const favSet = new Set(favs.map((f) => f.recipeId));
  const initialRecipes = rows.map((r) => ({ ...r, isFavorite: favSet.has(r.id) }));

  return <RecipesClient initialRecipes={initialRecipes} />;
}
