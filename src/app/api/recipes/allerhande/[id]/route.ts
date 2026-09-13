import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { getRecipe } from "@/lib/ah/recipes";
import { downloadAndSaveImage } from "@/lib/uploads";

export const maxDuration = 30;

// Returns an Allerhande recipe in the shape the recipe form takes, with the
// hero image copied to our own uploads so the card keeps working if AH's
// image host changes.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireHouseholdMember();
    const { id } = await params;
    if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "Not an Allerhande recipe id." }, { status: 400 });
    const recipe = await getRecipe(Number(id));
    if (!recipe) return NextResponse.json({ error: "Allerhande doesn't have that recipe (any more)." }, { status: 404 });
    const imageUrl = recipe.imageUrl ? await downloadAndSaveImage(recipe.imageUrl) : null;
    return NextResponse.json({ recipe: { ...recipe, imageUrl: imageUrl ?? recipe.imageUrl } });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("allerhande recipe failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't reach Allerhande right now. Try again in a minute." }, { status: 502 });
  }
}
