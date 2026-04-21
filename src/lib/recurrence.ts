import { RRule } from "rrule";

/**
 * Given an RRULE string and the just-completed occurrence's due date,
 * return the NEXT occurrence after `now` (or after the completed one).
 *
 * Returns null if the series has no further occurrences.
 */
export function nextTodoOccurrence(rule: string, lastDue: Date, now: Date): Date | null {
  const r = parseRule(rule, lastDue);
  if (!r) return null;
  // rrule works in UTC ms; pick after the larger of (lastDue, now) so you don't
  // double-up if the user completes late.
  const after = new Date(Math.max(lastDue.getTime(), now.getTime()));
  const next = r.after(after, false);
  return next ?? null;
}

/**
 * Parse an RRULE string. Accepts either "FREQ=DAILY;INTERVAL=1" (what we
 * store) or a full "DTSTART... RRULE:..." blob.
 */
function parseRule(rule: string, dtstart: Date): RRule | null {
  try {
    if (rule.includes("RRULE:") || rule.startsWith("DTSTART")) {
      return RRule.fromString(rule);
    }
    const opts = RRule.parseString(rule);
    opts.dtstart = dtstart;
    return new RRule(opts);
  } catch {
    return null;
  }
}

/**
 * Expand an RRULE into occurrence dates within [from, to].
 * Useful for calendar / upcoming view.
 */
export function expandRule(rule: string, dtstart: Date, from: Date, to: Date): Date[] {
  const r = parseRule(rule, dtstart);
  if (!r) return [];
  return r.between(from, to, true);
}
