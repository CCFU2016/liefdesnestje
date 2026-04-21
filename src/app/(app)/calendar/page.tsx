import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, householdMembers } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { CalendarShell } from "@/components/calendar/calendar-shell";

export default async function CalendarPage() {
  const ctx = await requireHouseholdMember();

  // Both members' linked calendars (user-scoped, but surface them all to the household)
  const members = await db
    .select({ userId: householdMembers.userId, displayName: householdMembers.displayName, color: householdMembers.color })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId));

  const userIds = members.map((m) => m.userId);
  const accounts = userIds.length
    ? await db.select().from(externalCalendarAccounts).where(inArray(externalCalendarAccounts.userId, userIds))
    : [];

  const linkedCalendars = accounts.length
    ? await db
        .select()
        .from(calendars)
        .where(
          and(
            inArray(calendars.accountId, accounts.map((a) => a.id)),
            eq(calendars.syncEnabled, true)
          )
        )
    : [];

  return (
    <CalendarShell
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
      }))}
    />
  );
}
