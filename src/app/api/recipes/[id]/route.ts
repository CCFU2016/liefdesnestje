import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { recipes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const ingredientSchema = z.object({
  quantity: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  name: z.string().min(1),
  notes: z.string().nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  servings: z.number().int().positive().optional(),
  prepTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  cookTimeMinutes: z.number().int().nonnegative().nullable().optional(),
  ingredients: z.array(ingredientSchema).optional(),
  instructions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  nutritionPerServing: z
    .object({
      calories: z.number().nullable(),
      protein: z.number().nullable(),
      carbs: z.number().nullable(),
      fat: z.number().nullable(),
      fiber: z.number().nullable(),
    })
    .nullable()
    .optional(),
  sourceUrl: z.string().url().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  score: z.number().int().min(1).max(5).nullable().optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  cookedIncrement: z.boolean().optional(),
});

async function loadForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const r = (await db.select().from(recipes).where(eq(recipes.id, id)).limit(1))[0];
  if (!r) return null;
  if (r.householdId !== ctx.householdId) return null;
  if (r.visibility === "private" && r.authorId !== ctx.userId) return null;
  if (r.deletedAt) return null;
  return r;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const r = await loadForCaller(id, ctx);
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ recipe: r });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const r = await loadForCaller(id, ctx);
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Non-authors can't edit recipes (they can favorite / cook them only)
    if (r.authorId !== ctx.userId && body.data.cookedIncrement !== true) {
      return NextResponse.json({ error: "Only the recipe author can edit." }, { status: 403 });
    }

    const update: Partial<typeof recipes.$inferInsert> = { updatedAt: new Date() };
    const d = body.data;
    if (d.title !== undefined) update.title = d.title;
    if (d.description !== undefined) update.description = d.description;
    if (d.servings !== undefined) update.servings = d.servings;
    if (d.prepTimeMinutes !== undefined) update.prepTimeMinutes = d.prepTimeMinutes;
    if (d.cookTimeMinutes !== undefined) update.cookTimeMinutes = d.cookTimeMinutes;
    if (d.ingredients !== undefined) update.ingredients = d.ingredients;
    if (d.instructions !== undefined) update.instructions = d.instructions;
    if (d.tags !== undefined) update.tags = d.tags;
    if (d.nutritionPerServing !== undefined) update.nutritionPerServing = d.nutritionPerServing;
    if (d.sourceUrl !== undefined) update.sourceUrl = d.sourceUrl;
    if (d.imageUrl !== undefined) update.imageUrl = d.imageUrl;
    if (d.score !== undefined) update.score = d.score;
    if (d.visibility !== undefined) update.visibility = d.visibility;
    if (d.cookedIncrement === true) update.cookedCount = r.cookedCount + 1;

    const [updated] = await db.update(recipes).set(update).where(eq(recipes.id, id)).returning();
    return NextResponse.json({ recipe: updated });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const r = await loadForCaller(id, ctx);
    if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (r.authorId !== ctx.userId) {
      return NextResponse.json({ error: "Only the recipe author can delete." }, { status: 403 });
    }
    await db.update(recipes).set({ deletedAt: new Date() }).where(eq(recipes.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
