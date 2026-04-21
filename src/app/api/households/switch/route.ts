import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { households, householdInvites, householdMembers } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth/config";

const schema = z.object({
  inviteToken: z.string().min(10),
  displayName: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

/**
 * Leave the user's current household and join the household the invite belongs to.
 * Safety rules:
 *  - Only allowed if the user is the SOLE member of their current household
 *    (prevents accidental abandonment of a shared household / partner).
 *  - Deletes the old household row (cascades all its data — todos, notes,
 *    events, trips — which she presumably hasn't filled in yet).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { inviteToken, displayName, color } = parsed.data;

  // Load the user's current membership
  const myMembership = (
    await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.userId, session.user.id))
      .limit(1)
  )[0];
  if (!myMembership) {
    return NextResponse.json({ error: "You're not in a household yet — use the onboarding flow." }, { status: 400 });
  }

  // Load invite
  const invite = (
    await db.select().from(householdInvites).where(eq(householdInvites.token, inviteToken)).limit(1)
  )[0];
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invite invalid or expired" }, { status: 400 });
  }
  if (invite.householdId === myMembership.householdId) {
    return NextResponse.json({ error: "You're already in that household" }, { status: 400 });
  }

  // Safety: user must be alone in their current household
  const otherMembers = await db
    .select()
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, myMembership.householdId),
        ne(householdMembers.userId, session.user.id)
      )
    );
  if (otherMembers.length > 0) {
    return NextResponse.json(
      { error: "Can't switch — you share that household with someone. Remove them first." },
      { status: 400 }
    );
  }

  // Color collision in destination household?
  const colorTaken = (
    await db
      .select()
      .from(householdMembers)
      .where(
        and(eq(householdMembers.householdId, invite.householdId), eq(householdMembers.color, color))
      )
      .limit(1)
  )[0];
  if (colorTaken) {
    return NextResponse.json(
      { error: "Pick a different color — your partner's using that one." },
      { status: 400 }
    );
  }

  // Delete old household (cascade drops members, todo_lists, notes, events, trips, invites)
  const oldHouseholdId = myMembership.householdId;
  await db.delete(households).where(eq(households.id, oldHouseholdId));

  // Join destination household
  await db.insert(householdMembers).values({
    userId: session.user.id,
    householdId: invite.householdId,
    role: "member",
    displayName,
    color,
  });
  await db
    .update(householdInvites)
    .set({ acceptedAt: new Date() })
    .where(eq(householdInvites.token, inviteToken));

  return NextResponse.json({ householdId: invite.householdId });
}
