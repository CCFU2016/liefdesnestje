import { db } from "@/lib/db";
import { externalCalendarAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/auth/encryption";
import { refreshTokens } from "./oauth";

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * Returns a valid access token for the given account, refreshing if needed.
 * Updates the DB atomically when refreshing.
 */
export async function getAccessToken(accountId: string): Promise<string> {
  const row = (
    await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, accountId)).limit(1)
  )[0];
  if (!row) throw new Error("Calendar account not found");

  const margin = 60_000; // 60s
  if (row.expiresAt.getTime() - margin > Date.now()) {
    return decrypt(row.accessTokenEnc);
  }

  const refreshed = await refreshTokens(decrypt(row.refreshTokenEnc));
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await db
    .update(externalCalendarAccounts)
    .set({
      accessTokenEnc: encrypt(refreshed.access_token),
      // Graph rotates refresh tokens on use; keep the new one.
      refreshTokenEnc: encrypt(refreshed.refresh_token),
      expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(externalCalendarAccounts.id, accountId));
  return refreshed.access_token;
}

export async function graphFetch<T>(
  accountId: string,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken(accountId);
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GraphError(res.status, body, url);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class GraphError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`Graph ${status} ${url}`);
  }
}

// --- Types (partial) ---

export type MsCalendar = {
  id: string;
  name: string;
  color?: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  owner?: { name?: string; address?: string };
};

export type MsDateTimeTz = { dateTime: string; timeZone: string };

export type MsEvent = {
  id: string;
  "@odata.etag"?: string;
  "@removed"?: { reason: string };
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: "html" | "text"; content: string };
  start: MsDateTimeTz;
  end: MsDateTimeTz;
  isAllDay: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  originalStartTimeZone?: string;
  recurrence?: unknown;
  type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  seriesMasterId?: string;
};

// --- Helpers ---

export async function getMe(accountId: string): Promise<{ id: string; userPrincipalName: string; mail?: string }> {
  return graphFetch(accountId, "/me?$select=id,userPrincipalName,mail");
}

export async function listCalendars(accountId: string): Promise<MsCalendar[]> {
  const res = await graphFetch<{ value: MsCalendar[] }>(accountId, "/me/calendars?$top=50");
  return res.value;
}

export async function deltaEvents(
  accountId: string,
  calendarExternalId: string,
  deltaLink: string | null
): Promise<{ value: MsEvent[]; nextDeltaLink: string | null }> {
  const url = deltaLink
    ? deltaLink
    : `/me/calendars/${calendarExternalId}/events/delta?$select=id,subject,bodyPreview,body,start,end,isAllDay,isCancelled,location,type,seriesMasterId`;

  type Page = { value: MsEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
  const all: MsEvent[] = [];
  let next: string | null = url;
  let delta: string | null = null;
  while (next) {
    const page: Page = await graphFetch<Page>(accountId, next);
    all.push(...page.value);
    if (page["@odata.nextLink"]) next = page["@odata.nextLink"];
    else {
      delta = page["@odata.deltaLink"] ?? null;
      next = null;
    }
  }
  return { value: all, nextDeltaLink: delta };
}

export async function createEvent(
  accountId: string,
  calendarExternalId: string,
  payload: Partial<MsEvent>
): Promise<MsEvent> {
  return graphFetch<MsEvent>(accountId, `/me/calendars/${calendarExternalId}/events`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateEvent(
  accountId: string,
  externalId: string,
  payload: Partial<MsEvent>,
  etag?: string | null
): Promise<MsEvent> {
  return graphFetch<MsEvent>(accountId, `/me/events/${externalId}`, {
    method: "PATCH",
    headers: etag ? { "If-Match": etag } : undefined,
    body: JSON.stringify(payload),
  });
}

export async function deleteEvent(accountId: string, externalId: string): Promise<void> {
  await graphFetch(accountId, `/me/events/${externalId}`, { method: "DELETE" });
}

// --- Subscriptions (webhooks) ---

export type MsSubscription = {
  id: string;
  resource: string;
  expirationDateTime: string;
  clientState: string;
  notificationUrl: string;
};

export async function createSubscription(
  accountId: string,
  calendarExternalId: string,
  opts: { notificationUrl: string; clientState: string; expiresInHours?: number }
): Promise<MsSubscription> {
  const expiresAt = new Date(Date.now() + (opts.expiresInHours ?? 70) * 60 * 60 * 1000).toISOString();
  return graphFetch<MsSubscription>(accountId, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created,updated,deleted",
      notificationUrl: opts.notificationUrl,
      resource: `/me/calendars/${calendarExternalId}/events`,
      expirationDateTime: expiresAt,
      clientState: opts.clientState,
    }),
  });
}

export async function renewSubscription(
  accountId: string,
  subscriptionId: string,
  expiresInHours = 70
): Promise<MsSubscription> {
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  return graphFetch<MsSubscription>(accountId, `/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime: expiresAt }),
  });
}

export async function deleteSubscription(accountId: string, subscriptionId: string): Promise<void> {
  await graphFetch(accountId, `/subscriptions/${subscriptionId}`, { method: "DELETE" });
}
