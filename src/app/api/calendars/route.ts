import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, householdMembers } from "@/lib/db/schema";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();

    const members = await db
      .select({ userId: householdMembers.userId, displayName: householdMembers.displayName, color: householdMembers.color })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId));

    const userIds = members.map((m) => m.userId);
    const accounts = userIds.length
      ? await db.select().from(externalCalendarAccounts).where(inArray(externalCalendarAccounts.userId, userIds))
      : [];

    // Calendars visible to this household are either:
    //   - OAuth calendars: accountId ∈ household members' accounts, OR
    //   - ICS subscriptions: directly household-scoped via calendars.householdId
    const accountIds = accounts.map((a) => a.id);
    const cals = await db
      .select()
      .from(calendars)
      .where(
        or(
          accountIds.length ? inArray(calendars.accountId, accountIds) : undefined,
          eq(calendars.householdId, ctx.householdId)
        )!
      )
      .orderBy(asc(calendars.name));

    const memberByUserId = new Map(members.map((m) => [m.userId, m]));
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    const payload = cals.map((c) => {
      if (c.sourceType === "ics") {
        return {
          id: c.id,
          name: c.name,
          color: c.color ?? "#7c3aed",
          syncEnabled: c.syncEnabled,
          showOnToday: c.showOnToday,
          provider: "ics" as const,
          accountEmail: c.icsUrl ?? "",
          ownerUserId: null,
          ownerIsMe: true, // ICS is household-wide, any member can manage
          ownerDisplayName: "Subscription",
          lastSyncedAt: c.lastSyncedAt,
          lastError: c.lastError,
          icsUrl: c.icsUrl,
          writable: false,
        };
      }
      const account = accountById.get(c.accountId!)!;
      const member = memberByUserId.get(account.userId);
      return {
        id: c.id,
        name: c.name,
        color: c.color ?? "#4f46e5",
        syncEnabled: c.syncEnabled,
        showOnToday: c.showOnToday,
        provider: account.provider,
        accountEmail: account.externalAccountId,
        ownerUserId: account.userId,
        ownerIsMe: account.userId === ctx.userId,
        ownerDisplayName: member?.displayName ?? "Partner",
        lastSyncedAt: null,
        lastError: null,
        icsUrl: null,
        writable: account.userId === ctx.userId,
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

// silence unused-import linting while keeping the symbol available for IDE jump-to
void and;
