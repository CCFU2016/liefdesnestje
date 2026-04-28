import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { householdMembers, todoLists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TodosPage } from "@/components/todos/todos-page";
import { ChoresSection } from "@/components/chores/chores-section";
import { LeaderboardCard } from "@/components/chores/leaderboard-card";
import { ManageChores } from "@/components/chores/manage-chores";

export default async function Todos() {
  const ctx = await requireHouseholdMember();
  const [lists, members] = await Promise.all([
    db.select().from(todoLists).where(eq(todoLists.householdId, ctx.householdId)).orderBy(todoLists.sortOrder),
    db.select({
      userId: householdMembers.userId,
      displayName: householdMembers.displayName,
      color: householdMembers.color,
      avatarUrl: householdMembers.avatarUrl,
    }).from(householdMembers).where(eq(householdMembers.householdId, ctx.householdId)),
  ]);
  // Strip avatarUrl when handing off to TodosPage — its own type doesn't
  // include it. ChoresSection / LeaderboardCard read avatars themselves.
  const slimMembers = members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    color: m.color,
  }));
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8 space-y-0">
      <ChoresSection members={members} />
      <TodosPage initialLists={lists} members={slimMembers} currentUserId={ctx.userId} />
      <div className="mt-4">
        <LeaderboardCard />
        <ManageChores />
      </div>
    </div>
  );
}
