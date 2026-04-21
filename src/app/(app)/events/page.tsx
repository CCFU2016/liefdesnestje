import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import {
  eventCategories,
  externalCalendarAccounts,
  holidays,
  householdMembers,
} from "@/lib/db/schema";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { ensureDefaultCategories } from "@/lib/event-categories";
import { EventsClient } from "./client";

export default async function EventsPage() {
  const ctx = await requireHouseholdMember();
  await ensureDefaultCategories(ctx.householdId);

  const [rows, members, myAccounts, categories] = await Promise.all([
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
    db
      .select()
      .from(eventCategories)
      .where(eq(eventCategories.householdId, ctx.householdId))
      .orderBy(asc(eventCategories.sortOrder), asc(eventCategories.name)),
  ]);

  const connectedProviders = Array.from(new Set(myAccounts.map((a) => a.provider))) as Array<
    "google" | "microsoft"
  >;

  return (
    <EventsClient
      initialEvents={rows}
      members={members}
      currentUserId={ctx.userId}
      connectedProviders={connectedProviders}
      categories={categories}
    />
  );
}
