import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { householdMembers, recipes } from "@/lib/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { MealsClient } from "./client";

export default async function MealsPage() {
  const ctx = await requireHouseholdMember();

  const [recipeList, members] = await Promise.all([
    db
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
      .orderBy(desc(recipes.updatedAt)),
    db
      .select({
        userId: householdMembers.userId,
        displayName: householdMembers.displayName,
        color: householdMembers.color,
      })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId)),
  ]);

  return <MealsClient recipes={recipeList} currentUserId={ctx.userId} members={members} />;
}
