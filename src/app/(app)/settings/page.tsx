import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { externalCalendarAccounts, householdMembers, households } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SettingsClient } from "./client";

export default async function SettingsPage() {
  const ctx = await requireHouseholdMember();

  const [household] = await db.select().from(households).where(eq(households.id, ctx.householdId));
  const members = await db
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId));

  const myAccounts = await db
    .select({
      id: externalCalendarAccounts.id,
      provider: externalCalendarAccounts.provider,
      externalAccountId: externalCalendarAccounts.externalAccountId,
      expiresAt: externalCalendarAccounts.expiresAt,
    })
    .from(externalCalendarAccounts)
    .where(eq(externalCalendarAccounts.userId, ctx.userId));

  return (
    <SettingsClient
      household={household}
      members={members}
      currentUserId={ctx.userId}
      myAccounts={myAccounts}
    />
  );
}
