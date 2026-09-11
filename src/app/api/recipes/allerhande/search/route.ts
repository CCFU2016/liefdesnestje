import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { searchRecipes } from "@/lib/ah/recipes";

const querySchema = z.object({ q: z.string().trim().min(2).max(200) });

// Anonymous AH call; no Claude, so it does not count against the extraction budget.
export async function GET(req: Request) {
  try {
    await requireHouseholdMember();
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
    if (!parsed.success) return NextResponse.json({ error: "Type at least two letters." }, { status: 400 });
    const { total, recipes } = await searchRecipes(parsed.data.q, 12);
    return NextResponse.json({ total, recipes });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("allerhande search failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't reach Allerhande right now. Try again in a minute." }, { status: 502 });
  }
}
