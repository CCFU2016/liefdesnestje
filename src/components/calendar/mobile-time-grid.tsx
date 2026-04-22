"use client";

import { useEffect, useMemo, useRef } from "react";
import { addDays, format, isSameDay } from "date-fns";

// Simple, hand-rolled 3-day time grid — used on mobile because rbc's TimeGrid
// doesn't cope well with narrow viewports. Guarantees the classic layout:
// hours down the left, days across the top, events placed by their start/end
// times inside the correct day column.

export type MobileEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  // Arbitrary data passed straight through to the click handler.
  resource?: unknown;
};

const HOUR_PX = 48; // height of one hour in the grid
const GUTTER_PX = 44; // width of the hour gutter on the left

export function MobileTimeGrid({
  events,
  anchor,
  days = 3,
  scrollToHour = 8,
  onNavigate,
  onSelectEvent,
  onSelectSlot,
}: {
  events: MobileEvent[];
  anchor: Date;
  days?: number;
  scrollToHour?: number;
  onNavigate: (newAnchor: Date) => void;
  onSelectEvent: (e: MobileEvent) => void;
  onSelectSlot: (day: Date, hour: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const dayList = useMemo(
    () => Array.from({ length: days }, (_, i) => startOfDay(addDays(anchor, i))),
    [anchor, days]
  );
  const dayStart = dayList[0];
  const dayEnd = addDays(dayList[dayList.length - 1], 1);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollToHour * HOUR_PX;
  }, [anchor, scrollToHour]);

  // Split events into all-day (visible in top strip) vs timed (placed in grid).
  // rbc's approach: anything marked allDay OR spanning more than one day goes
  // in the strip. For our purposes, same thing.
  const allDay = events.filter((e) => e.allDay || spansMultipleDays(e));
  const timed = events.filter((e) => !e.allDay && !spansMultipleDays(e));

  // Bucket timed events by day and assign horizontal column indices so
  // overlapping events sit side by side instead of stacking.
  const positionedByDay = useMemo(() => {
    const m = new Map<number, PositionedEvent[]>();
    for (const day of dayList) {
      const dayKey = day.getTime();
      const dayEvents = timed
        .filter((e) => isSameDay(e.start, day))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      m.set(dayKey, assignColumns(dayEvents));
    }
    return m;
  }, [timed, dayList]);

  // Prepare all-day event rendering — events that span multiple columns.
  const allDayRows = useMemo(() => layOutAllDay(allDay, dayList), [allDay, dayList]);

  const today = startOfDay(new Date());

  return (
    <div className="flex flex-col h-full border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-950">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNavigate(addDays(anchor, -days))}
            className="px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            onClick={() => onNavigate(today)}
            className="px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Today
          </button>
          <button
            onClick={() => onNavigate(addDays(anchor, days))}
            className="px-2 py-1 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Next"
          >
            ›
          </button>
        </div>
        <div className="text-sm font-medium">
          {format(dayList[0], "d MMM")} – {format(dayList[dayList.length - 1], "d MMM yyyy")}
        </div>
      </div>

      {/* Day headers */}
      <div className="shrink-0 flex border-b border-zinc-200 dark:border-zinc-800">
        <div style={{ width: GUTTER_PX }} />
        {dayList.map((day) => {
          const isToday = isSameDay(day, new Date());
          return (
            <div
              key={day.toISOString()}
              className={`flex-1 text-center py-1.5 text-xs ${
                isToday ? "bg-zinc-50 dark:bg-zinc-900" : ""
              }`}
            >
              <div className="text-zinc-500 uppercase tracking-wider text-[10px]">
                {format(day, "EEE")}
              </div>
              <div className={`font-semibold ${isToday ? "" : ""}`}>{format(day, "d")}</div>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      {allDayRows.length > 0 && (
        <div className="shrink-0 flex border-b border-zinc-200 dark:border-zinc-800 max-h-24 overflow-y-auto">
          <div
            style={{ width: GUTTER_PX }}
            className="text-[9px] text-zinc-500 px-1 py-1 uppercase tracking-wider shrink-0"
          >
            all day
          </div>
          <div
            className="flex-1 relative py-1 pr-1"
            style={{ minHeight: allDayRows.length * 22 + 4 }}
          >
            {allDayRows.map((row, rowIdx) =>
              row.map((seg) => (
                <button
                  key={`${seg.event.id}-${rowIdx}`}
                  onClick={() => onSelectEvent(seg.event)}
                  className="absolute text-left text-[11px] text-white rounded px-1.5 truncate hover:brightness-110"
                  style={{
                    background: seg.event.color,
                    top: rowIdx * 22,
                    height: 20,
                    left: `calc(${(seg.startCol / days) * 100}% + 2px)`,
                    width: `calc(${((seg.endCol - seg.startCol + 1) / days) * 100}% - 4px)`,
                  }}
                >
                  {seg.event.title}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: 24 * HOUR_PX }}>
          {/* Hour gutter */}
          <div style={{ width: GUTTER_PX }} className="relative shrink-0 border-r border-zinc-200 dark:border-zinc-800">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1.5 text-[10px] text-zinc-500 tabular-nums"
                style={{ top: h * HOUR_PX - 6, height: 12 }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {dayList.map((day) => {
            const positioned = positionedByDay.get(day.getTime()) ?? [];
            const isToday = isSameDay(day, new Date());
            const now = new Date();
            const showNowLine =
              isToday && now >= dayStart && now < dayEnd;
            const nowTop = minutesFromMidnight(now) / 60 * HOUR_PX;

            return (
              <div
                key={day.toISOString()}
                className={`flex-1 relative border-l border-zinc-200 dark:border-zinc-800 ${
                  isToday ? "bg-zinc-50/60 dark:bg-zinc-900/60" : ""
                }`}
                onClick={(e) => {
                  // Tap empty area → add event at that hour.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const hour = Math.max(0, Math.min(23, Math.floor(y / HOUR_PX)));
                  onSelectSlot(day, hour);
                }}
              >
                {/* Hour lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-zinc-200 dark:border-zinc-800"
                    style={{ top: h * HOUR_PX, opacity: h === 0 ? 0 : 1 }}
                  />
                ))}
                {/* Half-hour lines, subtler */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={`half-${h}`}
                    className="absolute inset-x-0 border-t border-dashed border-zinc-100 dark:border-zinc-900"
                    style={{ top: h * HOUR_PX + HOUR_PX / 2 }}
                  />
                ))}

                {/* Events */}
                {positioned.map((pe) => {
                  const top = (minutesFromMidnight(pe.event.start) / 60) * HOUR_PX;
                  const durationMin =
                    (pe.event.end.getTime() - pe.event.start.getTime()) / 60000;
                  const height = Math.max(18, (durationMin / 60) * HOUR_PX - 1);
                  const widthPct = 100 / pe.colCount;
                  const leftPct = pe.col * widthPct;
                  return (
                    <button
                      key={pe.event.id}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        onSelectEvent(pe.event);
                      }}
                      className="absolute rounded text-left px-1 py-0.5 text-white overflow-hidden shadow-sm hover:brightness-110"
                      style={{
                        background: pe.event.color,
                        top,
                        height,
                        left: `calc(${leftPct}% + 1px)`,
                        width: `calc(${widthPct}% - 2px)`,
                      }}
                    >
                      <div className="text-[11px] font-medium leading-tight truncate">
                        {pe.event.title}
                      </div>
                      {height >= 28 && (
                        <div className="text-[9px] opacity-80 tabular-nums">
                          {format(pe.event.start, "HH:mm")}
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* Now indicator */}
                {showNowLine && (
                  <div
                    className="absolute inset-x-0 z-10 pointer-events-none"
                    style={{ top: nowTop }}
                  >
                    <div className="h-0.5 bg-rose-500" />
                    <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function spansMultipleDays(e: MobileEvent): boolean {
  const a = startOfDay(e.start).getTime();
  const b = startOfDay(new Date(e.end.getTime() - 1)).getTime();
  return a !== b;
}

function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

type PositionedEvent = { event: MobileEvent; col: number; colCount: number };

// Greedy overlap-column assignment — for a group of events that all overlap,
// the group's colCount is the max nesting depth, and each event sits in the
// first column where no other active event overlaps it.
function assignColumns(sorted: MobileEvent[]): PositionedEvent[] {
  if (sorted.length === 0) return [];
  // Split into overlap groups so colCount stays tight within each group.
  const groups: MobileEvent[][] = [];
  let current: MobileEvent[] = [];
  let groupEnd = -Infinity;
  for (const e of sorted) {
    if (e.start.getTime() >= groupEnd) {
      if (current.length) groups.push(current);
      current = [e];
      groupEnd = e.end.getTime();
    } else {
      current.push(e);
      groupEnd = Math.max(groupEnd, e.end.getTime());
    }
  }
  if (current.length) groups.push(current);

  const out: PositionedEvent[] = [];
  for (const g of groups) {
    const placed: Array<{ event: MobileEvent; col: number }> = [];
    for (const e of g) {
      let col = 0;
      while (placed.some((p) => p.col === col && overlap(p.event, e))) col++;
      placed.push({ event: e, col });
    }
    const colCount = placed.reduce((m, p) => Math.max(m, p.col + 1), 1);
    for (const p of placed) out.push({ event: p.event, col: p.col, colCount });
  }
  return out;
}

function overlap(a: MobileEvent, b: MobileEvent): boolean {
  return a.start < b.end && b.start < a.end;
}

// All-day rows: each event becomes a segment with (startCol, endCol). Pack
// into the fewest rows via greedy first-fit.
type AllDaySeg = { event: MobileEvent; startCol: number; endCol: number };

function layOutAllDay(events: MobileEvent[], dayList: Date[]): AllDaySeg[][] {
  if (events.length === 0) return [];
  const segs: AllDaySeg[] = [];
  const viewStart = startOfDay(dayList[0]).getTime();
  const viewEnd = startOfDay(dayList[dayList.length - 1]).getTime();
  const MS_DAY = 86_400_000;

  for (const e of events) {
    const startDay = startOfDay(e.start).getTime();
    // An exclusive end like "April 22 00:00" for a whole-of-21 event is common
    // for Google; step back 1 ms to put the end on the correct day.
    const endDay = startOfDay(new Date(e.end.getTime() - 1)).getTime();

    // Skip events that don't overlap the view at all. Without this the
    // previous clamp-to-edges fallback drew past events (e.g. last week's
    // recurring all-day events still in the fetched window) as spanning
    // the full 3-day strip.
    if (endDay < viewStart) continue;
    if (startDay > viewEnd) continue;

    // Column = whole days from the view's first day, clamped to [0, N-1].
    const startColRaw = Math.round((startDay - viewStart) / MS_DAY);
    const endColRaw = Math.round((endDay - viewStart) / MS_DAY);
    const startCol = Math.max(0, startColRaw);
    const endCol = Math.min(dayList.length - 1, endColRaw);
    if (endCol < startCol) continue;
    segs.push({ event: e, startCol, endCol });
  }

  const rows: AllDaySeg[][] = [];
  for (const seg of segs) {
    let placed = false;
    for (const row of rows) {
      if (row.every((s) => s.endCol < seg.startCol || s.startCol > seg.endCol)) {
        row.push(seg);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([seg]);
  }
  return rows;
}
