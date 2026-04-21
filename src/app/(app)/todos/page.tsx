import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { householdMembers, todoLists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { TodosPage } from "@/components/todos/todos-page";

export default async function Todos() {
  const ctx = await requireHouseholdMember();
  const [lists, members] = await Promise.all([
    db.select().from(todoLists).where(eq(todoLists.householdId, ctx.householdId)).orderBy(todoLists.sortOrder),
    db.select({
      userId: householdMembers.userId,
      displayName: householdMembers.displayName,
      color: householdMembers.color,
    }).from(householdMembers).where(eq(householdMembers.householdId, ctx.householdId)),
  ]);
  return <TodosPage initialLists={lists} members={members} currentUserId={ctx.userId} />;
}
