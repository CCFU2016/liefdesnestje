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
  travelReservations,
} from "@/lib/db/schema";
import { and, desc, eq, gte, ilike, isNull, lte, or, inArray } from "drizzle-orm";
import { DinnerWeeklyPrompt } from "./dinner-weekly-prompt";
import { DayNav } from "./day-nav";
import { LocalTime } from "./local-time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, differenceInCalendarDays, endOfDay, format, isToday as isTodayFn, startOfDay } from "date-fns";
import Link from "next/link";
import { Bed, Car, ChevronRight as ArrowRightIcon, MapPin, Plane, Ship, Train, UtensilsCrossed } from "lucide-react";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireHouseholdMember();

  const { date: dateParam } = await searchParams;
  const dayDate = parseDateParam(dateParam) ?? new Date();
  const dayStart = startOfDay(dayDate);
  const dayEnd = endOfDay(dayDate);
  const today = toDateStr(dayDate);
  const viewingToday = isTodayFn(dayDate);

  const [todayEventsRaw, lists, members, tonightRaw, relevantHolidays, todayAbsences, todayTravel, nikiWorkRaw] = await Promise.all([
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
    // "Next event" = the nearest event whose window starts today or later,
    // AND "ongoing events" that started before today and haven't ended.
    // We fetch a small window of relevant rows once and split client-side.
    db
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.householdId, ctx.householdId),
          isNull(holidays.deletedAt),
          or(eq(holidays.visibility, "shared"), eq(holidays.authorId, ctx.userId)),
          or(
            gte(holidays.startsOn, today),
            and(lte(holidays.startsOn, today), gte(holidays.endsOn, today))
          )
        )
      )
      .orderBy(holidays.startsOn)
      .limit(20),
    db
      .select({ userId: dinnerAbsences.userId })
      .from(dinnerAbsences)
      .where(
        and(eq(dinnerAbsences.householdId, ctx.householdId), eq(dinnerAbsences.date, today))
      ),
    // Travel reservations active on the viewed day — any booking whose
    // window overlaps [dayStart, dayEnd]. Hotels span multiple days so
    // they appear every night of the stay. Flights typically have the
    // arrival in endAt so they show on both origin day and arrival day.
    db
      .select({
        id: travelReservations.id,
        holidayId: travelReservations.holidayId,
        kind: travelReservations.kind,
        title: travelReservations.title,
        startAt: travelReservations.startAt,
        endAt: travelReservations.endAt,
        location: travelReservations.location,
        origin: travelReservations.origin,
        destination: travelReservations.destination,
        confirmationCode: travelReservations.confirmationCode,
        travelerUserIds: travelReservations.travelerUserIds,
      })
      .from(travelReservations)
      .where(
        and(
          eq(travelReservations.householdId, ctx.householdId),
          isNull(travelReservations.deletedAt),
          lte(travelReservations.startAt, dayEnd),
          or(
            isNull(travelReservations.endAt),
            gte(travelReservations.endAt, dayStart)
          )
        )
      ),
    // Niki's work status — separate query so it fires regardless of whether
    // the "Niki werk" calendar is toggled on the Today widget (user may hide
    // the raw events but still want the status chip).
    //
    // Fetch all matches (Office NL + Telework may both be in the DB if the
    // user edited one into the other but the prior event didn't get
    // tombstoned) and let the post-filter pick the freshest by updatedAt.
    db
      .select({ title: events.title, updatedAt: events.updatedAt, startsAt: events.startsAt })
      .from(events)
      .leftJoin(calendars, eq(events.calendarId, calendars.id))
      .where(
        and(
          eq(events.householdId, ctx.householdId),
          isNull(events.deletedAt),
          eq(events.allDay, true),
          gte(events.endsAt, dayStart),
          lte(events.startsAt, dayEnd),
          ilike(calendars.name, "niki werk"),
          or(ilike(events.title, "office nl"), ilike(events.title, "telework"))
        )
      )
      .orderBy(desc(events.updatedAt)),
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

  const ongoingHolidays = relevantHolidays.filter(
    (h) => h.startsOn <= today && (h.endsOn ?? h.startsOn) >= today
  );
  const nextHoliday = relevantHolidays.find((h) => h.startsOn > today) ?? null;

  // Pick the freshest all-day event that actually overlaps today's local
  // window. The DB range filter can drag in a neighbouring day's all-day
  // event because UTC midnight boundaries drift across zones — the post-
  // filter checks the event's date against `today` (YYYY-MM-DD) directly.
  const nikiWorkToday = nikiWorkRaw.find((r) => {
    const s = new Date(r.startsAt);
    const ymd = `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
    return ymd === today;
  }) ?? nikiWorkRaw[0];
  const nikiWorkTitle = nikiWorkToday?.title?.toLowerCase() ?? null;
  const nikiWorkLabel =
    nikiWorkTitle === "office nl"
      ? "Niki op kantoor"
      : nikiWorkTitle === "telework"
        ? "Niki thuiswerken"
        : null;

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

  const prevDate = toDateStr(addDays(dayDate, -1));
  const nextDate = toDateStr(addDays(dayDate, 1));

  return (
    <div className="mx-auto max-w-5xl p-6 md:p-10">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
        {viewingToday ? (
          <>
            {greet()} — {format(dayDate, "EEEE, d MMMM")}
          </>
        ) : (
          format(dayDate, "EEEE, d MMMM yyyy")
        )}
      </h1>
      <p className="text-sm text-zinc-500 mt-1">
        {viewingToday ? "Here's what's on your plate." : "Browsing another day."}
      </p>

      <DayNav prevDate={prevDate} nextDate={nextDate} showTodayLink={!viewingToday} />

      {nikiWorkLabel && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
            {nikiWorkLabel}
          </span>
        </div>
      )}

      <div className="grid gap-4 mt-8 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{viewingToday ? "Today" : format(dayDate, "EEE, d MMM")}</CardTitle>
            <Link href="/calendar" className="text-xs text-zinc-500 hover:underline">Open calendar</Link>
          </CardHeader>
          <CardContent>
            {todayEvents.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing on the calendar {viewingToday ? "today" : "that day"}.</p>
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
            <CardTitle>{viewingToday ? "Tonight's dinner" : `Dinner · ${format(dayDate, "d MMM")}`}</CardTitle>
            <Link href="/meals" className="text-xs text-zinc-500 hover:underline">Open meals</Link>
          </CardHeader>
          <CardContent>
            {!tonight ? (
              <p className="text-sm text-zinc-500">Nothing planned. <Link href="/meals" className="underline">Plan a meal →</Link></p>
            ) : tonight.entry.restaurantName ? (
              <div className="flex items-start gap-3">
                <div className="h-14 w-14 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <UtensilsCrossed className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{tonight.entry.restaurantName}</div>
                  {tonight.entry.reservationAt && (
                    <div className="text-xs text-zinc-500">
                      Reservation <LocalTime iso={new Date(tonight.entry.reservationAt).toISOString()} fallback="…" />
                    </div>
                  )}
                  {tonight.entry.restaurantAddress && (
                    <div className="text-xs text-zinc-500 truncate">
                      {tonight.entry.restaurantAddress}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {tonight.entry.restaurantMenuUrl && (
                      <a
                        href={tonight.entry.restaurantMenuUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      >
                        Menu
                      </a>
                    )}
                    {(tonight.entry.restaurantName || tonight.entry.restaurantAddress) && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          [tonight.entry.restaurantName, tonight.entry.restaurantAddress]
                            .filter(Boolean)
                            .join(", ")
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                      >
                        <MapPin className="h-3 w-3" /> Open in Maps
                      </a>
                    )}
                  </div>
                </div>
              </div>
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

        {todayTravel.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Travel {viewingToday ? "today" : `· ${format(dayDate, "d MMM")}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {todayTravel.map((r) => {
                  const travelers = r.travelerUserIds
                    .map((uid) => memberByUserId.get(uid))
                    .filter((m): m is NonNullable<typeof m> => !!m);
                  const startDate = new Date(r.startAt);
                  const endDate = r.endAt ? new Date(r.endAt) : null;
                  const isCheckIn = r.kind === "hotel" && sameDayUtc(startDate, dayStart);
                  const isCheckOut = r.kind === "hotel" && !!endDate && sameDayUtc(endDate, dayStart);
                  const whenLabel =
                    r.kind === "hotel"
                      ? isCheckIn
                        ? "Check-in tonight"
                        : isCheckOut
                          ? "Check-out"
                          : "Overnight stay"
                      : null;
                  const subtitle =
                    r.kind === "flight" || r.kind === "train"
                      ? `${r.origin ?? ""}${r.destination ? ` → ${r.destination}` : ""}`
                      : r.location ?? "";
                  const mapsQuery =
                    r.location || r.destination || r.origin
                      ? [r.title, r.location, r.destination].filter(Boolean).join(", ")
                      : null;
                  return (
                    <li
                      key={r.id}
                      className="flex items-start gap-3 rounded-md p-2 -m-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <div className="mt-0.5 h-9 w-9 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 flex items-center justify-center shrink-0">
                        {travelIcon(r.kind)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/events/${r.holidayId}`}
                          className="font-medium truncate block hover:underline"
                        >
                          {r.title}
                        </Link>
                        <div className="text-xs text-zinc-500">
                          {whenLabel ?? (
                            <LocalTime iso={startDate.toISOString()} fallback="…" />
                          )}
                          {subtitle ? ` · ${subtitle}` : ""}
                        </div>
                        {(travelers.length > 0 || mapsQuery) && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {travelers.map((m) => (
                              <span
                                key={m.userId}
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-1.5 py-0 text-[10px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                              >
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full"
                                  style={{ background: m.color }}
                                />
                                {m.displayName}
                              </span>
                            ))}
                            {mapsQuery && (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                              >
                                <MapPin className="h-3 w-3" /> Maps
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

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

        {viewingToday && (
          <DinnerWeeklyPrompt
            members={members.map((m) => ({
              userId: m.userId,
              displayName: m.displayName,
              color: m.color,
            }))}
          />
        )}

        {ongoingHolidays.length > 0 && (
          <Card className={ongoingHolidays.length > 1 || !nextHoliday ? "md:col-span-2" : undefined}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Ongoing events</CardTitle>
              <Link href="/events" className="text-xs text-zinc-500 hover:underline">Open events</Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {ongoingHolidays.map((h) => {
                  const start = parseDate(h.startsOn);
                  const end = h.endsOn ? parseDate(h.endsOn) : null;
                  const totalDays = end ? differenceInCalendarDays(end, start) + 1 : 1;
                  const dayNum = differenceInCalendarDays(dayDate, start) + 1;
                  return (
                    <li key={h.id}>
                      <Link
                        href={`/events/${h.id}`}
                        className="flex items-start justify-between gap-3 rounded-md p-2 -m-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{h.title}</div>
                          <div className="text-xs text-zinc-500">
                            {format(start, "d MMM")}
                            {end ? ` – ${format(end, "d MMM yyyy")}` : ""}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-zinc-500">
                            Day {dayNum} of {totalDays}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

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
                    {differenceInCalendarDays(parseDate(nextHoliday.startsOn), new Date())}
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

function travelIcon(kind: string) {
  const cn = "h-5 w-5";
  switch (kind) {
    case "hotel":
      return <Bed className={cn} />;
    case "flight":
      return <Plane className={cn} />;
    case "train":
      return <Train className={cn} />;
    case "car_rental":
      return <Car className={cn} />;
    case "ferry":
      return <Ship className={cn} />;
    default:
      return <ArrowRightIcon className={cn} />;
  }
}

function sameDayUtc(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseDateParam(s: string | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}
