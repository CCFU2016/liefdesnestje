import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { recipes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CookMode } from "@/components/recipes/cook-mode";

export default async function CookModePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireHouseholdMember();
  const r = (await db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
  if (!r || r.householdId !== ctx.householdId || r.deletedAt) notFound();
  if (r.visibility === "private" && r.authorId !== ctx.userId) notFound();

  return (
    <CookMode
      recipeId={r.id}
      title={r.title}
      servings={r.servings}
      ingredients={
        r.ingredients as Array<{
          quantity: string | null;
          unit: string | null;
          name: string;
          notes: string | null;
        }>
      }
      instructions={r.instructions as string[]}
    />
  );
}
