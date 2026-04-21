import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { householdMembers } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const patchSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function PATCH(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    // If changing color, make sure it's not already used by a different member.
    if (body.data.color) {
      const conflict = (
        await db
          .select()
          .from(householdMembers)
          .where(
            and(
              eq(householdMembers.householdId, ctx.householdId),
              eq(householdMembers.color, body.data.color),
              ne(householdMembers.userId, ctx.userId)
            )
          )
          .limit(1)
      )[0];
      if (conflict) {
        return NextResponse.json(
          { error: "Your partner's using that color — pick another." },
          { status: 400 }
        );
      }
    }

    const [updated] = await db
      .update(householdMembers)
      .set({
        ...(body.data.displayName !== undefined ? { displayName: body.data.displayName } : {}),
        ...(body.data.color !== undefined ? { color: body.data.color } : {}),
      })
      .where(
        and(
          eq(householdMembers.userId, ctx.userId),
          eq(householdMembers.householdId, ctx.householdId)
        )
      )
      .returning();

    return NextResponse.json({ member: updated });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
