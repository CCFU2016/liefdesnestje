import { requireHouseholdMember } from "@/lib/auth/household";
import { db } from "@/lib/db";
import {
  calendars,
  dinnerAbsences,
  events,
  externalCalendarAccounts,
  holidays,
  householdMembers,
  mealPlanEntries,
  recipes,
  todos,
  todoLists,
} from "@/lib/db/schema";
import { and, eq, gte, isNull, lte, or, inArray } from "drizzle-orm";
import { DinnerWeeklyPrompt } from "./dinner-weekly-prompt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { differenceInCalendarDays, endOfDay, format, startOfDay } from "date-fns";
import Link from "next/link";

export default async function TodayPage() {
  const ctx = await requireHouseholdMember();

  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);
  const today = toDateStr(now);

  const [todayEventsRaw, lists, members, tonightRaw, nextHoliday, todayAbsences] = await Promise.all([
    db
      .select({ event: events, calendar: calendars, account: externalCalendarAccounts })
      .from(events)
      .leftJoin(calendars, eq(events.calendarId, calendars.id))
      .leftJoin(externalCalendarAccounts, eq(calendars.accountId, externalCalendarAccounts.id))
      .where(
        and(
          eq(events.householdId, ctx.householdId),
          isNull(events.deletedAt),
          gte(events.endsAt, dayStart),
          lte(events.startsAt, dayEnd),
          or(eq(events.visibility, "shared"), eq(events.authorId, ctx.userId)),
          or(
            isNull(events.calendarId),
            and(eq(calendars.syncEnabled, true), eq(calendars.showOnToday, true))
          )
        )
      )
      .orderBy(events.startsAt),
    db.select().from(todoLists).where(eq(todoLists.householdId, ctx.householdId)),
    db
      .select({ userId: householdMembers.userId, displayName: householdMembers.displayName, color: householdMembers.color })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId)),
    db
      .select({ entry: mealPlanEntries, recipe: recipes })
      .from(mealPlanEntries)
      .leftJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          eq(mealPlanEntries.householdId, ctx.householdId),
          isNull(mealPlanEntries.deletedAt),
          eq(mealPlanEntries.date, today),
          or(eq(mealPlanEntries.visibility, "shared"), eq(mealPlanEntries.authorId, ctx.userId))
        )
      )
      .limit(1),
    db
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.householdId, ctx.householdId),
          isNull(holidays.deletedAt),
          gte(holidays.startsOn, today),
          or(eq(holidays.visibility, "shared"), eq(holidays.authorId, ctx.userId))
        )
      )
      .orderBy(holidays.startsOn)
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ userId: dinnerAbsences.userId })
      .from(dinnerAbsences)
      .where(
        and(eq(dinnerAbsences.householdId, ctx.householdId), eq(dinnerAbsences.date, today))
      ),
  ]);

  const memberByUserId = new Map(members.map((m) => [m.userId, m]));

  const todayEvents = todayEventsRaw.map((r) => {
    let startsAt = r.event.startsAt;
    let endsAt = r.event.endsAt;
    if (r.event.allDay) {
      const s = new Date(startsAt);
      const e = new Date(endsAt);
      startsAt = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
      endsAt = new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
    }
    return {
      ...r.event,
      startsAt,
      endsAt,
      color:
        r.calendar?.color ??
        memberByUserId.get(r.account?.userId ?? r.event.authorId)?.color ??
        "#71717a",
      ownerName: memberByUserId.get(r.account?.userId ?? r.event.authorId)?.displayName,
    };
  });

  const tonight = tonightRaw[0];

  const absentMembers = todayAbsences
    .map((a) => memberByUserId.get(a.userId))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

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

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-10">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
        {greet()} — {format(now, "EEEE, d MMMM")}
      </h1>
      <p className="text-sm text-zinc-500 mt-1">Here&apos;s what&apos;s on your plate.</p>

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
                    <span
                      className="mt-1.5 inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: e.color }}
                    />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.title}</div>
                      <div className="text-xs text-zinc-500">
                        {e.allDay ? "All day" : `${format(e.startsAt, "HH:mm")}–${format(e.endsAt, "HH:mm")}`}
                        {e.location ? ` · ${e.location}` : ""}
                        {e.ownerName && ` · ${e.ownerName}`}
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
            <CardTitle>Tonight&apos;s dinner</CardTitle>
            <Link href="/meals" className="text-xs text-zinc-500 hover:underline">Open meals</Link>
          </CardHeader>
          <CardContent>
            {!tonight ? (
              <p className="text-sm text-zinc-500">Nothing planned. <Link href="/meals" className="underline">Plan a meal →</Link></p>
            ) : (
              <div className="flex items-center gap-3">
                {tonight.recipe?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tonight.recipe.imageUrl}
                    alt=""
                    className="h-14 w-14 rounded-md object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {tonight.recipe?.title ?? tonight.entry.freeText ?? "Dinner"}
                  </div>
                  {tonight.recipe?.cookTimeMinutes && (
                    <div className="text-xs text-zinc-500">
                      ~{tonight.recipe.cookTimeMinutes} min cook time
                    </div>
                  )}
                  {tonight.recipe && (
                    <Link
                      href={`/meals/recipes/${tonight.recipe.id}/cook`}
                      className="text-xs text-zinc-600 hover:underline mt-0.5 inline-block"
                    >
                      Start cook mode →
                    </Link>
                  )}
                </div>
              </div>
            )}
            {absentMembers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {absentMembers.map((m) => (
                  <span
                    key={m.userId}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: m.color }}
                    />
                    {m.displayName} eating out
                  </span>
                ))}
              </div>
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

        <DinnerWeeklyPrompt
          members={members.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
            color: m.color,
          }))}
        />

        {nextHoliday && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Next event</CardTitle>
              <Link href="/events" className="text-xs text-zinc-500 hover:underline">Open events</Link>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline justify-between">
                <div className="min-w-0">
                  <div className="text-lg font-medium truncate">{nextHoliday.title}</div>
                  <div className="text-sm text-zinc-500">
                    {format(parseDate(nextHoliday.startsOn), "d MMM yyyy")}
                    {nextHoliday.endsOn && ` – ${format(parseDate(nextHoliday.endsOn), "d MMM yyyy")}`}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="text-3xl font-bold">
                    {differenceInCalendarDays(parseDate(nextHoliday.startsOn), now)}
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

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
