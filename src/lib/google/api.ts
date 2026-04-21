import { db } from "@/lib/db";
import { externalCalendarAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/auth/encryption";
import { refreshTokens } from "./oauth";

const BASE = "https://www.googleapis.com/calendar/v3";

/** Returns a valid access token, refreshing if needed. */
export async function getAccessToken(accountId: string): Promise<string> {
  const row = (
    await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, accountId)).limit(1)
  )[0];
  if (!row) throw new Error("Calendar account not found");

  const margin = 60_000;
  if (row.expiresAt.getTime() - margin > Date.now()) {
    return decrypt(row.accessTokenEnc);
  }

  const refreshed = await refreshTokens(decrypt(row.refreshTokenEnc));
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db
    .update(externalCalendarAccounts)
    .set({
      accessTokenEnc: encrypt(refreshed.access_token),
      // Google doesn't always return a new refresh_token — keep existing if absent.
      ...(refreshed.refresh_token
        ? { refreshTokenEnc: encrypt(refreshed.refresh_token) }
        : {}),
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(externalCalendarAccounts.id, accountId));
  return refreshed.access_token;
}

export class GoogleApiError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`Google ${status} ${url}`);
  }
}

export async function googleFetch<T>(
  accountId: string,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken(accountId);
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text(), url);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Types (partial) ---

export type GcalCalendarListEntry = {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  backgroundColor?: string;
  colorId?: string;
  accessRole?: "owner" | "writer" | "reader" | "freeBusyReader";
};

export type GcalDateTime =
  | { dateTime: string; timeZone?: string } // e.g. "2026-04-21T09:00:00+02:00"
  | { date: string }; // all-day YYYY-MM-DD

export type GcalEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GcalDateTime;
  end?: GcalDateTime;
  recurrence?: string[]; // RRULE strings
  recurringEventId?: string;
  originalStartTime?: GcalDateTime;
};

// --- Helpers ---

export async function getMe(accountId: string): Promise<{ email: string }> {
  // userinfo endpoint is outside calendar/v3
  const token = await getAccessToken(accountId);
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text(), "userinfo");
  return (await res.json()) as { email: string };
}

export async function listCalendars(accountId: string): Promise<GcalCalendarListEntry[]> {
  const all: GcalCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams();
    if (pageToken) qs.set("pageToken", pageToken);
    qs.set("minAccessRole", "writer");
    qs.set("maxResults", "100");
    const page: { items?: GcalCalendarListEntry[]; nextPageToken?: string } = await googleFetch(
      accountId,
      `/users/me/calendarList?${qs}`
    );
    all.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all;
}

export type ListEventsResult = {
  events: GcalEvent[];
  nextSyncToken: string | null;
  syncTokenInvalidated: boolean;
};

/**
 * Pull events since syncToken (or all future events if none). Handles paging
 * and the 410-Gone case (syncToken expired) by signalling the caller so they
 * can do a full resync.
 */
export async function listEventsDelta(
  accountId: string,
  calendarExternalId: string,
  syncToken: string | null
): Promise<ListEventsResult> {
  const all: GcalEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let syncTokenInvalidated = false;

  while (true) {
    const qs = new URLSearchParams();
    qs.set("maxResults", "250");
    qs.set("singleEvents", "true");
    if (pageToken) qs.set("pageToken", pageToken);
    if (syncToken && !pageToken) qs.set("syncToken", syncToken);
    if (!syncToken && !pageToken) {
      // initial pull: limit to ~1 year back to bound work
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      qs.set("timeMin", from);
      qs.set("showDeleted", "false");
    } else {
      qs.set("showDeleted", "true"); // delta should include tombstones
    }

    try {
      const page: {
        items?: GcalEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      } = await googleFetch(
        accountId,
        `/calendars/${encodeURIComponent(calendarExternalId)}/events?${qs}`
      );
      all.push(...(page.items ?? []));
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        continue;
      }
      nextSyncToken = page.nextSyncToken ?? null;
      break;
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 410) {
        // syncToken invalidated — caller should drop it and do a full pull
        syncTokenInvalidated = true;
        return { events: [], nextSyncToken: null, syncTokenInvalidated: true };
      }
      throw e;
    }
  }

  return { events: all, nextSyncToken, syncTokenInvalidated };
}

export async function createEvent(
  accountId: string,
  calendarExternalId: string,
  payload: Partial<GcalEvent>
): Promise<GcalEvent> {
  return googleFetch<GcalEvent>(
    accountId,
    `/calendars/${encodeURIComponent(calendarExternalId)}/events`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export async function updateEvent(
  accountId: string,
  calendarExternalId: string,
  externalEventId: string,
  payload: Partial<GcalEvent>,
  etag?: string | null
): Promise<GcalEvent> {
  return googleFetch<GcalEvent>(
    accountId,
    `/calendars/${encodeURIComponent(calendarExternalId)}/events/${encodeURIComponent(externalEventId)}`,
    {
      method: "PATCH",
      headers: etag ? { "If-Match": etag } : undefined,
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteEvent(
  accountId: string,
  calendarExternalId: string,
  externalEventId: string
): Promise<void> {
  await googleFetch(
    accountId,
    `/calendars/${encodeURIComponent(calendarExternalId)}/events/${encodeURIComponent(externalEventId)}`,
    { method: "DELETE" }
  );
}

// --- Push notification channels ---

export type GcalChannel = {
  id: string;
  resourceId: string;
  resourceUri: string;
  token?: string;
  expiration?: string; // ms since epoch as string
};

export async function watchEvents(
  accountId: string,
  calendarExternalId: string,
  opts: { channelId: string; address: string; token: string; ttlSeconds?: number }
): Promise<GcalChannel> {
  const body: Record<string, unknown> = {
    id: opts.channelId,
    type: "web_hook",
    address: opts.address,
    token: opts.token,
  };
  if (opts.ttlSeconds) body.params = { ttl: String(opts.ttlSeconds) };
  return googleFetch<GcalChannel>(
    accountId,
    `/calendars/${encodeURIComponent(calendarExternalId)}/events/watch`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function stopChannel(
  accountId: string,
  channelId: string,
  resourceId: string
): Promise<void> {
  await googleFetch(accountId, `/channels/stop`, {
    method: "POST",
    body: JSON.stringify({ id: channelId, resourceId }),
  });
}
