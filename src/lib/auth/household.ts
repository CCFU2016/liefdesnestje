import { auth } from "./config";
import { db } from "@/lib/db";
import { householdMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type HouseholdContext = {
  userId: string;
  householdId: string;
  role: "owner" | "member";
  displayName: string;
  color: string;
};

export class UnauthorizedError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Returns the caller's household context or throws. Use in every API route
 * and server action that returns or mutates household data.
 *
 * Every query in the app should scope by the `householdId` returned here.
 */
export async function requireHouseholdMember(): Promise<HouseholdContext> {
  const session = await auth();
  if (!session?.user?.id) throw new UnauthorizedError(401, "Not signed in");

  const rows = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.userId, session.user.id))
    .limit(1);

  const member = rows[0];
  if (!member) throw new UnauthorizedError(403, "Not a member of any household");

  return {
    userId: member.userId,
    householdId: member.householdId,
    role: member.role,
    displayName: member.displayName,
    color: member.color,
  };
}

/** Asserts the given householdId matches the caller's. */
export async function assertSameHousehold(householdId: string): Promise<HouseholdContext> {
  const ctx = await requireHouseholdMember();
  if (ctx.householdId !== householdId) {
    throw new UnauthorizedError(403, "Cross-household access denied");
  }
  return ctx;
}

/** Checks membership without throwing. */
export async function getMembership(userId: string, householdId: string) {
  const rows = await db
    .select()
    .from(householdMembers)
    .where(
      and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId))
    )
    .limit(1);
  return rows[0] ?? null;
}
