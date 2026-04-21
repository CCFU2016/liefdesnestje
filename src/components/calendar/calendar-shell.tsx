"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Calendar, dateFnsLocalizer, type View, type Event as RBCEvent } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { toast } from "sonner";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EventDialog } from "./event-dialog";

const locales = { "en-US": enUS };
// Week starts Monday, not Sunday.
const startOfWeekMonday = (date: Date | number) => startOfWeek(date, { weekStartsOn: 1 });
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: startOfWeekMonday, getDay, locales });

type CalendarVM = {
  id: string;
  accountId: string;
  name: string;
  color: string;
  syncEnabled: boolean;
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
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function isMobile() {
  return typeof window !== "undefined" && window.innerWidth < 768;
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
  members,
  accounts,
  calendars,
}: {
  members: { userId: string; displayName: string; color: string }[];
  accounts: AccountVM[];
  calendars: CalendarVM[];
}) {
  const [view, setView] = useState<View>(isMobile() ? "agenda" : "week");
  const [anchor, setAnchor] = useState(new Date());
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set());
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
      .map((e) => ({
        title: e.title,
        start: new Date(e.startsAt),
        end: new Date(e.endsAt),
        allDay: e.allDay,
        resource: e,
      }));
  }, [data, hiddenCalendars]);

  const eventStyleGetter = (event: RBCEvent) => {
    const r = (event as RBCEvent & { resource: EventRow }).resource;
    const cal = r.calendarId ? calendarsById.get(r.calendarId) : null;
    const color = cal?.color ?? "#4f46e5";
    return {
      style: {
        backgroundColor: color,
        borderRadius: 4,
        border: "none",
        color: "white",
        fontSize: 12,
      },
    };
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

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="flex gap-4 md:gap-6">
        <aside className="hidden md:block w-56 shrink-0 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Calendars</h3>
            </div>
            <ul className="space-y-1 text-sm">
              {calendars.map((c) => {
                const hidden = hiddenCalendars.has(c.id);
                return (
                  <li key={c.id}>
                    <button
                      className="flex w-full items-center gap-2 text-left opacity-100 hover:opacity-80"
                      onClick={() => {
                        const n = new Set(hiddenCalendars);
                        if (hidden) n.delete(c.id);
                        else n.add(c.id);
                        setHiddenCalendars(n);
                      }}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: hidden ? "transparent" : c.color, border: `2px solid ${c.color}` }}
                      />
                      <span className={hidden ? "line-through text-zinc-400" : ""}>{c.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-2">Nest members</h3>
            <ul className="space-y-1 text-sm">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: m.color }} />
                  <span>{m.displayName}</span>
                </li>
              ))}
            </ul>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await fetch("/api/calendar-sync", { method: "POST" });
              mutate();
              toast.success("Synced");
            }}
          >
            Sync now
          </Button>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 overflow-hidden">
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
              views={["month", "week", "day", "agenda"]}
              length={30}
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
          <div className="md:hidden mt-2 flex items-center justify-between text-xs text-zinc-500">
            <button
              onClick={async () => {
                await fetch("/api/calendar-sync", { method: "POST" });
                mutate();
                toast.success("Synced");
              }}
              className="px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Sync now
            </button>
            <span>{calendars.filter((c) => !hiddenCalendars.has(c.id)).length} calendars</span>
          </div>

          {/* Legend — what each color means */}
          {(calendars.length > 0 || members.length > 0) && (
            <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Legend</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                {calendars.filter((c) => !hiddenCalendars.has(c.id)).map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.color }} />
                    <span>{c.name}</span>
                  </div>
                ))}
                {members.length > 0 && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    {members.map((m) => (
                      <div key={m.userId} className="flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ background: m.color }} />
                        <span>{m.displayName}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
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
          calendars={calendars.filter((c) =>
            accounts.some((a) => a.id === c.accountId && a.userId) // only own-writable calendars
          )}
          initialEvent={dialog.event ?? null}
          initialSlot={dialog.slot ?? null}
        />
      )}
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
