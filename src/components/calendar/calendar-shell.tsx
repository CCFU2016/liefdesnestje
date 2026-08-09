"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Calendar, dateFnsLocalizer, type View, type Event as RBCEvent } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { toast } from "sonner";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EventDialog } from "./event-dialog";
import { ThreeDayView } from "./three-day-view";
import { MobileTimeGrid, type MobileEvent } from "./mobile-time-grid";

const locales = { "en-US": enUS };
// Week starts Monday, not Sunday.
const startOfWeekMonday = (date: Date | number) => startOfWeek(date, { weekStartsOn: 1 });
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: startOfWeekMonday, getDay, locales });

type CalendarVM = {
  id: string;
  accountId: string | null;
  name: string;
  color: string;
  syncEnabled: boolean;
  writable: boolean;
};

type AccountVM = {
  id: string;
  userId: string;
  provider: "google" | "microsoft";
  externalAccountId: string;
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  calendarId: string | null;
  authorId: string;
  visibility: "private" | "shared";
  organizerName?: string | null;
  organizerEmail?: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Best-effort: infer "current user id" from the list of accounts passed in.
// Since /api/calendars returns writable=true only for the caller's accounts,
// this is just used as a secondary guard and no longer strictly necessary.
function currentUserIdFromAcc(accounts: AccountVM[]): string | undefined {
  return accounts[0]?.userId;
}

// 24-hour formats for react-big-calendar (defaults are 12h AM/PM).
const formats = {
  timeGutterFormat: "HH:mm",
  eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "HH:mm")}–${format(end, "HH:mm")}`,
  selectRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "HH:mm")}–${format(end, "HH:mm")}`,
  agendaTimeFormat: "HH:mm",
  agendaTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "HH:mm")}–${format(end, "HH:mm")}`,
  agendaHeaderFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "d MMM")} – ${format(end, "d MMM")}`,
  dayHeaderFormat: "EEEE, d MMM",
  dayRangeHeaderFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "d MMM")} – ${format(end, "d MMM")}`,
};

export function CalendarShell({
  currentUserId,
  members,
  accounts,
  calendars,
}: {
  currentUserId: string;
  members: { userId: string; displayName: string; color: string }[];
  accounts: AccountVM[];
  calendars: CalendarVM[];
}) {
  const [onMobile, setOnMobile] = useState(false);
  useEffect(() => {
    const check = () => setOnMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Prefs key scoped to the user so Niki and Laura don't overwrite each
  // other's calendar visibility choices on a shared laptop.
  const prefsKey = `lnest:cal:v1:${currentUserId}`;

  // view state uses names valid in BOTH configs ('week' exists on mobile too,
  // just points at ThreeDayView there — avoids SSR/hydration mismatch).
  const [view, setView] = useState<View>("week");
  useEffect(() => {
    // Month view isn't available on mobile — bounce to Week (= 3-day) if user
    // shrinks the window while on Month.
    if (onMobile && view === "month") setView("week");
  }, [onMobile, view]);

  const views = useMemo(
    () =>
      onMobile
        ? ({ day: true, week: ThreeDayView, agenda: true } as unknown as View[])
        : (["month", "week", "day", "agenda"] as View[]),
    [onMobile]
  );

  // Default scroll position: 8 AM. Lazy useState = computed once at mount,
  // which is also what keeps the react-hooks purity lint happy.
  const [scrollToTime] = useState(() => {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d;
  });
  const [anchor, setAnchor] = useState(new Date());
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set());

  // Hydrate prefs from localStorage after mount. (SSR has no localStorage,
  // so we load in an effect and let React re-render.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(prefsKey);
      if (!raw) return;
      const prefs = JSON.parse(raw) as { view?: View; hiddenCalendars?: string[] };
      if (prefs.view) setView(prefs.view);
      if (prefs.hiddenCalendars) setHiddenCalendars(new Set(prefs.hiddenCalendars));
    } catch {
      // corrupt prefs — ignore
    }

  }, [prefsKey]);

  // Persist on every change (after the initial hydration render).
  const prefsMounted = useRef(false);
  useEffect(() => {
    if (!prefsMounted.current) {
      prefsMounted.current = true;
      return;
    }
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        prefsKey,
        JSON.stringify({ view, hiddenCalendars: Array.from(hiddenCalendars) })
      );
    } catch {
      // quota / private browsing — skip
    }
  }, [view, hiddenCalendars, prefsKey]);
  const [dialog, setDialog] = useState<{
    event?: EventRow;
    slot?: { start: Date; end: Date };
  } | null>(null);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const key = accounts.length
    ? `/api/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`
    : null;

  const { data, mutate, isLoading } = useSWR<{ events: EventRow[] }>(key, fetcher, {
    refreshInterval: 30_000,
  });

  // On mount, trigger a background sync pull.
  useEffect(() => {
    if (accounts.length === 0) return;
    fetch("/api/calendar-sync", { method: "POST" })
      .then(() => mutate())
      .catch(() => {});

  }, []);

  const calendarsById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  const rbcEvents: (RBCEvent & { resource: EventRow })[] = useMemo(() => {
    const rows = data?.events ?? [];
    return rows
      .filter((e) => (e.calendarId ? !hiddenCalendars.has(e.calendarId) : true))
      .map((e) => {
        let start = new Date(e.startsAt);
        let end = new Date(e.endsAt);
        if (e.allDay) {
          // All-day events are stored as UTC midnight. In non-UTC timezones
          // (e.g. CEST = UTC+2) that displays as "2am local". Normalize to
          // local midnight of the same calendar date so rbc renders them in
          // the all-day strip correctly.
          start = new Date(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
          end = new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
        }
        return { title: e.title, start, end, allDay: e.allDay, resource: e };
      });
  }, [data, hiddenCalendars]);

  const eventStyleGetter = (event: RBCEvent) => {
    const r = (event as RBCEvent & { resource: EventRow }).resource;
    const cal = r.calendarId ? calendarsById.get(r.calendarId) : null;
    const color = cal?.color ?? "#4f46e5";
    // The chrome CSS renders the pill (neutral surface + 3px colored bar);
    // we only supply the per-calendar color.
    return { style: { "--pill-c": color } as React.CSSProperties };
  };

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 md:p-10">
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-2">Connect a calendar</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Link a calendar to see your events here. Liefdesnestje syncs both ways.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (window.location.href = "/api/integrations/microsoft/start")}>
              Connect Microsoft calendar
            </Button>
            <Button
              variant="secondary"
              onClick={() => (window.location.href = "/api/integrations/google/start")}
            >
              Connect Google calendar
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const toggleCalendar = (id: string) => {
    const next = new Set(hiddenCalendars);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHiddenCalendars(next);
  };

  const syncNow = async () => {
    await fetch("/api/calendar-sync", { method: "POST" });
    mutate();
    toast.success("Synced");
  };

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div>
        <div className="min-w-0">
          {onMobile ? (
            <div style={{ height: "calc(100dvh - 180px)", minHeight: 480 }}>
              <MobileTimeGrid
                events={rbcEvents.map(
                  (e): MobileEvent => ({
                    id: e.resource.id,
                    title: e.resource.title,
                    start: e.start!,
                    end: e.end!,
                    allDay: !!e.allDay,
                    color:
                      (e.resource.calendarId
                        ? calendarsById.get(e.resource.calendarId)?.color
                        : undefined) ?? "#4f46e5",
                    resource: e.resource,
                  })
                )}
                anchor={anchor}
                days={3}
                scrollToHour={8}
                onNavigate={setAnchor}
                onSelectEvent={(me) =>
                  setDialog({ event: (me.resource ?? me) as EventRow })
                }
                onSelectSlot={(day, hour) => {
                  if (calendars.length === 0) {
                    toast.message("Connect a calendar first.");
                    return;
                  }
                  const start = new Date(day);
                  start.setHours(hour, 0, 0, 0);
                  const end = new Date(start);
                  end.setHours(hour + 1);
                  setDialog({ slot: { start, end } });
                }}
              />
            </div>
          ) : (
            <div className="overflow-hidden">
              <Calendar
                localizer={localizer}
                formats={formats}
                events={rbcEvents}
                startAccessor="start"
                endAccessor="end"
                style={{ height: "calc(100dvh - 180px)", minHeight: 480 }}
                view={view}
                onView={setView}
                date={anchor}
                onNavigate={setAnchor}
                views={views}
                messages={{}}
                components={{
                  toolbar: (tp) => (
                    <CalendarToolbar
                      label={tp.label}
                      view={tp.view}
                      views={["month", "week", "day", "agenda"]}
                      onView={(v) => tp.onView(v as View)}
                      onNavigate={(a) => tp.onNavigate(a)}
                      onSync={syncNow}
                      onNew={() => {
                        const start = new Date();
                        start.setMinutes(0, 0, 0);
                        start.setHours(start.getHours() + 1);
                        const end = new Date(start);
                        end.setHours(end.getHours() + 1);
                        setDialog({ slot: { start, end } });
                      }}
                    />
                  ),
                }}
                length={30}
                scrollToTime={scrollToTime}
                selectable
                popup
                eventPropGetter={eventStyleGetter}
                onSelectSlot={(slot) => {
                  if (calendars.length === 0) {
                    toast.message("Connect a calendar first.");
                    return;
                  }
                  setDialog({ slot: { start: slot.start as Date, end: slot.end as Date } });
                }}
                onSelectEvent={(ev) =>
                  setDialog({ event: (ev as RBCEvent & { resource: EventRow }).resource })
                }
              />
            </div>
          )}
          {/* Legend — tap a calendar chip to toggle its visibility */}
          {(calendars.length > 0 || members.length > 0) && (
            <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2.5">
              <div className="flex flex-wrap gap-2">
                {calendars.map((c) => {
                  const hidden = hiddenCalendars.has(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCalendar(c.id)}
                      className={`inline-flex h-8 items-center gap-[7px] rounded-full border border-zinc-200 dark:border-zinc-800 px-3 text-[13px] transition-colors ${
                        hidden
                          ? "bg-transparent text-zinc-400 dark:text-zinc-500"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
                      }`}
                      title={hidden ? "Tap to show" : "Tap to hide"}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full flex-none"
                        style={
                          hidden
                            ? { border: `1.5px solid ${c.color}`, opacity: 0.6 }
                            : { background: c.color }
                        }
                      />
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <span className="hidden sm:block text-xs text-zinc-400 shrink-0">
                Tap to show or hide
              </span>
              {/* Mobile keeps a sync affordance here — desktop has it in the toolbar */}
              {onMobile && (
                <button
                  onClick={syncNow}
                  className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 shrink-0"
                >
                  ↻ Sync
                </button>
              )}
            </div>
          )}
          {isLoading && <div className="text-xs text-zinc-500 mt-2">Loading…</div>}
        </div>
      </div>

      {dialog && (
        <EventDialog
          open
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            mutate();
          }}
          calendars={calendars.filter(
            (c) =>
              c.writable &&
              accounts.some((a) => a.id === c.accountId && a.userId === currentUserIdFromAcc(accounts))
          )}
          initialEvent={dialog.event ?? null}
          initialSlot={dialog.slot ?? null}
        />
      )}
    </div>
  );
}

// Design: joined [‹ Today ›] group + 20px month label on the left;
// segmented view switcher + Sync now + sage "New" button on the right.
function CalendarToolbar({
  label,
  view,
  views,
  onView,
  onNavigate,
  onSync,
  onNew,
}: {
  label: string;
  view: string;
  views: string[];
  onView: (v: string) => void;
  onNavigate: (action: "PREV" | "NEXT" | "TODAY") => void;
  onSync: () => void;
  onNew: () => void;
}) {
  const viewLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={() => onNavigate("PREV")}
            className="flex h-8 w-8 items-center justify-center border-r border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            onClick={() => onNavigate("TODAY")}
            className="flex h-8 items-center border-r border-zinc-200 px-3 text-[13px] font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            Today
          </button>
          <button
            onClick={() => onNavigate("NEXT")}
            className="flex h-8 w-8 items-center justify-center text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="Next"
          >
            ›
          </button>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {label}
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex gap-0.5 rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              className={`rounded-md px-3 py-[5px] text-[13px] transition-colors ${
                v === view
                  ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {viewLabel(v)}
            </button>
          ))}
        </div>
        <button
          onClick={onSync}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[13px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Sync now
        </button>
        <button
          onClick={onNew}
          className="flex h-8 items-center gap-1 rounded-lg px-3.5 text-[13px] font-medium text-white"
          style={{ background: "var(--cal-accent)" }}
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>
    </div>
  );
}

function rangeFor(view: View, anchor: Date) {
  const d = new Date(anchor);
  if (view === "month") {
    const from = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 2, 0);
    return { from, to };
  }
  if (view === "week") {
    const day = d.getDay();
    const from = new Date(d);
    from.setDate(d.getDate() - day - 7);
    const to = new Date(d);
    to.setDate(d.getDate() - day + 14);
    return { from, to };
  }
  // day
  const from = new Date(d);
  from.setDate(d.getDate() - 1);
  const to = new Date(d);
  to.setDate(d.getDate() + 2);
  return { from, to };
}
