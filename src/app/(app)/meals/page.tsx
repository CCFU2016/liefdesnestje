import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { recipes } from "@/lib/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { MealsClient } from "./client";

export default async function MealsPage() {
  const ctx = await requireHouseholdMember();

  // Recipe list for the add-meal picker.
  const recipeList = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      imageUrl: recipes.imageUrl,
      servings: recipes.servings,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, ctx.householdId),
        isNull(recipes.deletedAt),
        or(eq(recipes.visibility, "shared"), eq(recipes.authorId, ctx.userId))
      )
    )
    .orderBy(desc(recipes.updatedAt));

  return <MealsClient recipes={recipeList} currentUserId={ctx.userId} />;
}
