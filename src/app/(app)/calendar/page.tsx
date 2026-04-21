import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, householdMembers } from "@/lib/db/schema";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { CalendarShell } from "@/components/calendar/calendar-shell";

export default async function CalendarPage() {
  const ctx = await requireHouseholdMember();

  const members = await db
    .select({ userId: householdMembers.userId, displayName: householdMembers.displayName, color: householdMembers.color })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId));

  const userIds = members.map((m) => m.userId);
  const accounts = userIds.length
    ? await db.select().from(externalCalendarAccounts).where(inArray(externalCalendarAccounts.userId, userIds))
    : [];
  const accountIds = accounts.map((a) => a.id);

  // Either OAuth calendars owned by members, or ICS subscriptions at household scope.
  const linkedCalendars = await db
    .select()
    .from(calendars)
    .where(
      and(
        eq(calendars.syncEnabled, true),
        or(
          accountIds.length ? inArray(calendars.accountId, accountIds) : undefined,
          eq(calendars.householdId, ctx.householdId)
        )!
      )
    )
    .orderBy(asc(calendars.name));

  return (
    <CalendarShell
      currentUserId={ctx.userId}
      members={members}
      accounts={accounts.map((a) => ({
        id: a.id,
        userId: a.userId,
        provider: a.provider,
        externalAccountId: a.externalAccountId,
      }))}
      calendars={linkedCalendars.map((c) => ({
        id: c.id,
        accountId: c.accountId,
        name: c.name,
        color: c.color ?? "#4f46e5",
        syncEnabled: c.syncEnabled,
        writable: c.sourceType === "oauth",
      }))}
    />
  );
}
