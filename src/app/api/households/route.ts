import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { households, householdMembers, householdInvites, todoLists } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const createSchema = z.object({
  displayName: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  householdName: z.string().min(1).max(60).optional(),
  inviteToken: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { displayName, color, householdName, inviteToken } = parsed.data;

  // Already a member?
  const existing = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, session.user.id))
    .limit(1);
  if (existing[0]) {
    return NextResponse.json({ error: "You already belong to a household" }, { status: 409 });
  }

  try {
    if (inviteToken) {
      // Join via invite
      const inviteRows = await db
        .select()
        .from(householdInvites)
        .where(eq(householdInvites.token, inviteToken))
        .limit(1);
      const invite = inviteRows[0];
      if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
        return NextResponse.json({ error: "Invite invalid or expired" }, { status: 400 });
      }

      // Check color is not taken in this household
      const colorTaken = await db
        .select()
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, invite.householdId), eq(householdMembers.color, color)))
        .limit(1);
      if (colorTaken[0]) {
        return NextResponse.json({ error: "Pick a different color — your partner's using that one." }, { status: 400 });
      }

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

    // Create new household
    const name = householdName?.trim() || "Our place";
    const [created] = await db.insert(households).values({ name }).returning();
    await db.insert(householdMembers).values({
      userId: session.user.id,
      householdId: created.id,
      role: "owner",
      displayName,
      color,
    });
    // Seed a default todo list
    await db.insert(todoLists).values({
      householdId: created.id,
      name: "Inbox",
      icon: "inbox",
      sortOrder: 0,
    });

    return NextResponse.json({ householdId: created.id });
  } catch (e) {
    console.error("household create/join failed", e);
    return NextResponse.json({ error: "Something went wrong, please try again." }, { status: 500 });
  }
}
