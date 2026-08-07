import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { householdMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PlacesClient } from "./client";

export default async function PlacesPage() {
  const ctx = await requireHouseholdMember();

  const members = await db
    .select({
      userId: householdMembers.userId,
      displayName: householdMembers.displayName,
      color: householdMembers.color,
      avatarUrl: householdMembers.avatarUrl,
    })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, ctx.householdId));

  return <PlacesClient members={members} currentUserId={ctx.userId} />;
}
