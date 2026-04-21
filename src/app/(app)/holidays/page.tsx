import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { externalCalendarAccounts, holidays, householdMembers } from "@/lib/db/schema";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { HolidaysClient } from "./client";

export default async function HolidaysPage() {
  const ctx = await requireHouseholdMember();

  const [rows, members, myAccounts] = await Promise.all([
    db
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.householdId, ctx.householdId),
          isNull(holidays.deletedAt),
          or(eq(holidays.visibility, "shared"), eq(holidays.authorId, ctx.userId))
        )
      )
      .orderBy(asc(holidays.startsOn)),
    db
      .select({
        userId: householdMembers.userId,
        displayName: householdMembers.displayName,
        color: householdMembers.color,
      })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId)),
    db
      .select({ provider: externalCalendarAccounts.provider })
      .from(externalCalendarAccounts)
      .where(eq(externalCalendarAccounts.userId, ctx.userId)),
  ]);

  const connectedProviders = Array.from(new Set(myAccounts.map((a) => a.provider))) as Array<"google" | "microsoft">;

  return (
    <HolidaysClient
      initialHolidays={rows}
      members={members}
      currentUserId={ctx.userId}
      connectedProviders={connectedProviders}
    />
  );
}
