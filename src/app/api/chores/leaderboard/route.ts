import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  householdMembers,
  recurringChoreCompletions,
  recurringChores,
} from "@/lib/db/schema";
import { and, between, eq, sql } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { todayInAmsterdam, weekEnd, weekStart } from "@/lib/chores/schedule";

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const range = (url.searchParams.get("range") ?? "all") as "week" | "all";

    // Sum pointsAwarded per (completed_by_id) for completions tied to a
    // live chore in this household. Joining gives us the household scope
    // (a chore_id alone doesn't carry that info — the join filters out
    // completions for chores in other households / soft-deleted chores).
    const conditions = [eq(recurringChores.householdId, ctx.householdId)];
    if (range === "week") {
      const today = todayInAmsterdam();
      const start = weekStart(today);
      const end = weekEnd(today);
      conditions.push(between(recurringChoreCompletions.completedOn, start, end));
    }

    const rows = await db
      .select({
        userId: recurringChoreCompletions.completedById,
        points: sql<number>`COALESCE(SUM(${recurringChoreCompletions.pointsAwarded}), 0)`.as(
          "points"
        ),
        completionsCount: sql<number>`COUNT(${recurringChoreCompletions.id})`.as(
          "completions_count"
        ),
      })
      .from(recurringChoreCompletions)
      .innerJoin(recurringChores, eq(recurringChores.id, recurringChoreCompletions.choreId))
      .where(and(...conditions))
      .groupBy(recurringChoreCompletions.completedById);

    // Decorate with member display info. Anyone in the household appears
    // on the board, even with 0 points, so the chart isn't lopsided.
    const members = await db
      .select({
        userId: householdMembers.userId,
        displayName: householdMembers.displayName,
        color: householdMembers.color,
        avatarUrl: householdMembers.avatarUrl,
      })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId));

    const byUser = new Map(rows.map((r) => [r.userId, r]));
    const board = members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      color: m.color,
      avatarUrl: m.avatarUrl,
      points: Number(byUser.get(m.userId)?.points ?? 0),
      completionsCount: Number(byUser.get(m.userId)?.completionsCount ?? 0),
    }));
    board.sort(
      (a, b) =>
        b.points - a.points ||
        b.completionsCount - a.completionsCount ||
        a.displayName.localeCompare(b.displayName)
    );

    return NextResponse.json(
      { range, leaderboard: board },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
