// Pure date helpers for the chores feature. Kept side-effect-free so the
// behaviour around carryover, the 60-day cap, and week boundaries can be
// unit-tested without touching the DB.

export type ChoreScheduleInput = {
  daysOfWeek: number[]; // 0..6, 0 = Sunday (matches JS Date#getDay)
  startsOn: string | null; // YYYY-MM-DD
  endsOn: string | null;
  rollsOver: boolean;
  rollsOverSince: string | null; // YYYY-MM-DD; populated when rollsOver flips to true
};

const CARRYOVER_LOOKBACK_DAYS = 60;

/** Strict YYYY-MM-DD validation. Throws on bad input. */
export function parseYmd(s: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Bad YYYY-MM-DD: ${s}`);
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Day-of-week (0..6, Sunday=0) for a YYYY-MM-DD string, treated as a calendar date. */
export function dayOfWeek(ymdStr: string): number {
  const { y, m, d } = parseYmd(ymdStr);
  // Construct in UTC so this is independent of server TZ — only the
  // calendar date matters for chore scheduling.
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Adds N days (can be negative) to a YYYY-MM-DD, returns YYYY-MM-DD. */
export function addDays(ymdStr: string, n: number): string {
  const { y, m, d } = parseYmd(ymdStr);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Inclusive YYYY-MM-DD comparison: returns true if a <= b. */
function lte(a: string, b: string): boolean {
  return a <= b; // string comparison is correct for zero-padded ISO dates
}
function gte(a: string, b: string): boolean {
  return a >= b;
}

/**
 * True if the chore's *normal weekly schedule* falls on this date —
 * day-of-week match, within startsOn/endsOn window. Doesn't consult
 * completions or carryover. Use this for the "scheduled today" row.
 */
export function choreOccursOn(chore: ChoreScheduleInput, date: string): boolean {
  if (!chore.daysOfWeek.includes(dayOfWeek(date))) return false;
  if (chore.startsOn && !gte(date, chore.startsOn)) return false;
  if (chore.endsOn && !lte(date, chore.endsOn)) return false;
  return true;
}

/**
 * Returns the list of past scheduled dates this chore was due on but never
 * completed, oldest first, capped to a 60-day lookback window. Used for
 * the carryover rows.
 *
 * Rules:
 *  - Only considered when rollsOver is true.
 *  - Lower bound is max(rollsOverSince ?? -∞, startsOn ?? -∞, today - 60d).
 *  - Upper bound is the day before `today` (today's row is "scheduled
 *    today", not carryover).
 *  - A date is included if (a) it matches daysOfWeek, (b) it's within
 *    startsOn/endsOn, (c) no completion exists for it.
 */
export function missedDatesForCarryover(
  chore: ChoreScheduleInput,
  completedDates: Set<string>,
  today: string
): string[] {
  if (!chore.rollsOver) return [];

  const lookbackFloor = addDays(today, -CARRYOVER_LOOKBACK_DAYS);
  const candidates: string[] = [];

  // Compose the lower bound: the latest of rollsOverSince, startsOn, lookback floor.
  let lower = lookbackFloor;
  if (chore.rollsOverSince && chore.rollsOverSince > lower) lower = chore.rollsOverSince;
  if (chore.startsOn && chore.startsOn > lower) lower = chore.startsOn;

  // Upper bound is yesterday — today's missed slot is still "scheduled today".
  const yesterday = addDays(today, -1);

  // Walk from lower to yesterday inclusive; cheap because the cap is 60d.
  let cursor = lower;
  while (cursor <= yesterday) {
    if (chore.daysOfWeek.includes(dayOfWeek(cursor))) {
      const inWindow =
        (!chore.startsOn || cursor >= chore.startsOn) &&
        (!chore.endsOn || cursor <= chore.endsOn);
      if (inWindow && !completedDates.has(cursor)) {
        candidates.push(cursor);
      }
    }
    cursor = addDays(cursor, 1);
  }
  return candidates;
}

/**
 * Today (calendar date) in Europe/Amsterdam. The whole feature thinks in
 * the household's wall-clock timezone, not the server's UTC.
 */
export function todayInAmsterdam(now: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD format — handy way to do this without pulling
  // in date-fns-tz for a single call.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Monday 00:00 of the ISO week containing the given date, returned as
 * YYYY-MM-DD. The leaderboard "this week" range is [weekStart, weekEnd].
 */
export function weekStart(ymdStr: string): string {
  const dow = dayOfWeek(ymdStr); // 0 = Sun, 1 = Mon, ...
  // Days to subtract to land on Monday: Sun → 6, Mon → 0, Tue → 1, ...
  const offset = dow === 0 ? 6 : dow - 1;
  return addDays(ymdStr, -offset);
}

export function weekEnd(ymdStr: string): string {
  return addDays(weekStart(ymdStr), 6);
}
