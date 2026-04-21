import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { recipes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { RecipeForm } from "@/components/recipes/recipe-form";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireHouseholdMember();
  const r = (await db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
  if (!r || r.householdId !== ctx.householdId || r.deletedAt) notFound();
  if (r.authorId !== ctx.userId) redirect(`/meals/recipes/${id}`);

  return (
    <RecipeForm
      recipeId={r.id}
      initial={{
        title: r.title,
        description: r.description,
        servings: r.servings,
        prepTimeMinutes: r.prepTimeMinutes,
        cookTimeMinutes: r.cookTimeMinutes,
        ingredients: r.ingredients as [],
        instructions: r.instructions as [],
        tags: r.tags,
        nutritionPerServing: r.nutritionPerServing as null,
        sourceUrl: r.sourceUrl,
        imageUrl: r.imageUrl,
        score: r.score,
        visibility: r.visibility,
      }}
    />
  );
}
