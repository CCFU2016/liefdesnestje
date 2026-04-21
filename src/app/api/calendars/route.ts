import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, householdMembers } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();

    // Include calendars for all accounts owned by any household member.
    const members = await db
      .select({ userId: householdMembers.userId, displayName: householdMembers.displayName, color: householdMembers.color })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId));

    const userIds = members.map((m) => m.userId);
    const accounts = userIds.length
      ? await db.select().from(externalCalendarAccounts).where(inArray(externalCalendarAccounts.userId, userIds))
      : [];
    const cals = accounts.length
      ? await db.select().from(calendars).where(inArray(calendars.accountId, accounts.map((a) => a.id)))
      : [];

    const memberByUserId = new Map(members.map((m) => [m.userId, m]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const payload = cals.map((c) => {
      const account = accountById.get(c.accountId)!;
      const member = memberByUserId.get(account.userId);
      return {
        id: c.id,
        name: c.name,
        color: c.color ?? "#4f46e5",
        syncEnabled: c.syncEnabled,
        provider: account.provider,
        accountEmail: account.externalAccountId,
        ownerUserId: account.userId,
        ownerIsMe: account.userId === ctx.userId,
        ownerDisplayName: member?.displayName ?? "Partner",
      };
    });

    return NextResponse.json({ calendars: payload });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
