import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { bucketListCategories, householdMembers } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { BucketListClient } from "./client";

export default async function BucketListPage() {
  const ctx = await requireHouseholdMember();

  const [members, categories] = await Promise.all([
    db
      .select({
        userId: householdMembers.userId,
        displayName: householdMembers.displayName,
        color: householdMembers.color,
        avatarUrl: householdMembers.avatarUrl,
      })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId)),
    db
      .select()
      .from(bucketListCategories)
      .where(eq(bucketListCategories.householdId, ctx.householdId))
      .orderBy(asc(bucketListCategories.sortOrder), asc(bucketListCategories.name)),
  ]);

  return (
    <BucketListClient
      members={members}
      initialCategories={categories}
      currentUserId={ctx.userId}
    />
  );
}
