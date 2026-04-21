import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import { events, todos, todoLists, trips } from "@/lib/db/schema";
import { and, eq, gte, isNull, lte, or, inArray } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { differenceInCalendarDays, endOfDay, format, startOfDay } from "date-fns";
import Link from "next/link";

export default async function TodayPage() {
  const ctx = await requireHouseholdMember();

  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [todayEvents, lists] = await Promise.all([
    db
      .select()
      .from(events)
      .where(
        and(
          eq(events.householdId, ctx.householdId),
          isNull(events.deletedAt),
          gte(events.endsAt, dayStart),
          lte(events.startsAt, dayEnd),
          or(eq(events.visibility, "shared"), eq(events.authorId, ctx.userId))
        )
      )
      .orderBy(events.startsAt),
    db.select().from(todoLists).where(eq(todoLists.householdId, ctx.householdId)),
  ]);

  const listIds = lists.map((l) => l.id);
  const topTodos = listIds.length
    ? await db
        .select()
        .from(todos)
        .where(
          and(
            inArray(todos.listId, listIds),
            isNull(todos.deletedAt),
            isNull(todos.completedAt),
            or(eq(todos.visibility, "shared"), eq(todos.authorId, ctx.userId))
          )
        )
        .orderBy(todos.sortOrder)
        .limit(5)
    : [];

  const upcomingTrip = (
    await db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.householdId, ctx.householdId),
          isNull(trips.deletedAt),
          gte(trips.startsAt, now),
          or(eq(trips.visibility, "shared"), eq(trips.authorId, ctx.userId))
        )
      )
      .orderBy(trips.startsAt)
      .limit(1)
  )[0];

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-10">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
        {greet()} — {format(now, "EEEE, d MMMM")}
      </h1>
      <p className="text-sm text-zinc-500 mt-1">Here's what's on your plate.</p>

      <div className="grid gap-4 mt-8 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Today</CardTitle>
            <Link href="/calendar" className="text-xs text-zinc-500 hover:underline">Open calendar</Link>
          </CardHeader>
          <CardContent>
            {todayEvents.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing on the calendar today.</p>
            ) : (
              <ul className="space-y-2">
                {todayEvents.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1 inline-block h-2 w-2 rounded-full bg-zinc-400" />
                    <div>
                      <div className="font-medium">{e.title}</div>
                      <div className="text-xs text-zinc-500">
                        {e.allDay ? "All day" : `${format(e.startsAt, "HH:mm")}–${format(e.endsAt, "HH:mm")}`}
                        {e.location ? ` · ${e.location}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Top to-dos</CardTitle>
            <Link href="/todos" className="text-xs text-zinc-500 hover:underline">Open to-dos</Link>
          </CardHeader>
          <CardContent>
            {topTodos.length === 0 ? (
              <p className="text-sm text-zinc-500">All clear — nothing pending.</p>
            ) : (
              <ul className="space-y-2">
                {topTodos.map((t) => (
                  <li key={t.id} className="text-sm">
                    {t.title}
                    {t.dueAt && (
                      <span className="ml-2 text-xs text-zinc-500">· due {format(t.dueAt, "d MMM")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {upcomingTrip && upcomingTrip.startsAt && (
          <Card className="md:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Next trip</CardTitle>
              <Link href="/trips" className="text-xs text-zinc-500 hover:underline">Open trips</Link>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-lg font-medium">{upcomingTrip.title}</div>
                  <div className="text-sm text-zinc-500">
                    {upcomingTrip.destination ?? ""} · {format(upcomingTrip.startsAt, "d MMM yyyy")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold">
                    {differenceInCalendarDays(upcomingTrip.startsAt, now)}
                  </div>
                  <div className="text-xs text-zinc-500">days</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
