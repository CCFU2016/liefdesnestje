import { Frequency, type RRule } from "rrule";

// Guard rails for ICS feeds. A feed is a URL someone else controls; without
// these, one broken or hostile feed (a multi-GB body, or a FREQ=SECONDLY
// rule that expands to tens of millions of dates) takes the app down, and
// the 6-hourly refresh cron takes it down again, forever.

export const MAX_ICS_BYTES = 5 * 1024 * 1024; // 5 MB — real feeds are tens of KB
export const MAX_OCCURRENCES_PER_EVENT = 1000; // > 2/day across the 455-day window
export const MAX_EVENTS_PER_FEED = 5000;

/** Sub-daily recurrences (HOURLY, MINUTELY, SECONDLY) are not calendar events we render. */
export function isRuleFrequencyAllowed(rule: Pick<RRule, "options">): boolean {
  // rrule enumerates YEARLY=0 … DAILY=3, HOURLY=4, MINUTELY=5, SECONDLY=6.
  return rule.options.freq <= Frequency.DAILY;
}

/**
 * Expand a recurrence rule inside [start, end], capped. Returns [] for
 * disallowed frequencies so the caller can skip the event with a warning
 * rather than fail the whole feed.
 */
export function expandRule(
  rule: RRule,
  start: Date,
  end: Date,
  max: number = MAX_OCCURRENCES_PER_EVENT
): Date[] {
  if (!isRuleFrequencyAllowed(rule)) return [];
  // The iterator callback lets rrule stop early instead of materialising
  // every occurrence first and slicing afterwards.
  return rule.between(start, end, true, (_d, i) => i < max);
}

export class FeedTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Feed is larger than ${Math.round(maxBytes / 1024 / 1024)} MB; refusing to import it`);
    this.name = "FeedTooLargeError";
  }
}

/**
 * Read a response body as text, aborting once it exceeds `maxBytes`.
 * `res.text()` has no cap; this streams and bails early instead.
 */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FeedTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}
