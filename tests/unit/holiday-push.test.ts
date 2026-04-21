import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level stub storage
const accounts = new Map<string, { id: string; userId: string; provider: "google" | "microsoft" }>();
const calendars_ = new Map<string, { id: string; accountId: string; externalId: string }>();
const createCalls: Array<{ provider: string; payload: unknown }> = [];
const updateCalls: Array<{ provider: string; externalEventId: string; payload: unknown }> = [];
const deleteCalls: Array<{ provider: string; externalEventId: string }> = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: (_sel?: unknown) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            // Determine which table via a crude tag
            const tag = (table as { _name?: string })._name ?? "";
            if (tag === "accounts") return Array.from(accounts.values());
            if (tag === "calendars") return Array.from(calendars_.values());
            return [];
          },
          orderBy: () => ({
            limit: () => Array.from(calendars_.values()),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  externalCalendarAccounts: Object.assign({ id: "external_id_col", userId: "user_id_col", provider: "provider_col" }, { _name: "accounts" }),
  calendars: Object.assign({ id: "id_col", accountId: "account_id_col", externalId: "external_id_col", syncEnabled: "sync_col" }, { _name: "calendars" }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Stub the provider graph clients
vi.mock("@/lib/microsoft/graph", () => ({
  createEvent: vi.fn(async (accountId: string, _extId: string, payload: unknown) => {
    createCalls.push({ provider: "microsoft", payload });
    return { id: "ms-event-123", "@odata.etag": "etag-1" };
  }),
  updateEvent: vi.fn(async (accountId: string, externalEventId: string, payload: unknown) => {
    updateCalls.push({ provider: "microsoft", externalEventId, payload });
    return { id: externalEventId, "@odata.etag": "etag-2" };
  }),
  deleteEvent: vi.fn(async (_accountId: string, externalEventId: string) => {
    deleteCalls.push({ provider: "microsoft", externalEventId });
  }),
}));

vi.mock("@/lib/google/api", () => ({
  createEvent: vi.fn(async (_accountId: string, _extId: string, payload: unknown) => {
    createCalls.push({ provider: "google", payload });
    return { id: "g-event-456", etag: "etag-g-1" };
  }),
  updateEvent: vi.fn(async (_accountId: string, _extId: string, externalEventId: string, payload: unknown) => {
    updateCalls.push({ provider: "google", externalEventId, payload });
    return { id: externalEventId, etag: "etag-g-2" };
  }),
  deleteEvent: vi.fn(async (_accountId: string, _extId: string, externalEventId: string) => {
    deleteCalls.push({ provider: "google", externalEventId });
  }),
}));

beforeEach(() => {
  accounts.clear();
  calendars_.clear();
  createCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
});

describe("pushHolidayToCalendar", () => {
  it("pushes to Google when only Google is connected", async () => {
    accounts.set("a1", { id: "a1", userId: "u1", provider: "google" });
    calendars_.set("c1", { id: "c1", accountId: "a1", externalId: "primary" });

    const { pushHolidayToCalendar } = await import("@/lib/calendar-push");
    const result = await pushHolidayToCalendar({
      userId: "u1",
      provider: "google",
      title: "Ski trip",
      description: "Austria",
      startsOn: "2026-04-25",
      endsOn: "2026-04-30",
    });

    expect(result).toEqual({ externalEventId: "g-event-456", calendarId: "c1" });
    expect(createCalls).toHaveLength(1);
    const payload = createCalls[0].payload as {
      summary: string;
      start: { date: string };
      end: { date: string };
    };
    expect(payload.summary).toBe("Ski trip");
    expect(payload.start.date).toBe("2026-04-25");
    // end is exclusive — one past endsOn
    expect(payload.end.date).toBe("2026-05-01");
  });

  it("uses Microsoft when asked explicitly", async () => {
    accounts.set("a1", { id: "a1", userId: "u1", provider: "microsoft" });
    calendars_.set("c1", { id: "c1", accountId: "a1", externalId: "primary-ms" });

    const { pushHolidayToCalendar } = await import("@/lib/calendar-push");
    const result = await pushHolidayToCalendar({
      userId: "u1",
      provider: "microsoft",
      title: "Bank holiday",
      description: null,
      startsOn: "2026-05-01",
      endsOn: null,
    });

    expect(result?.externalEventId).toBe("ms-event-123");
    expect(createCalls).toHaveLength(1);
    const payload = createCalls[0].payload as { subject: string; isAllDay: boolean };
    expect(payload.subject).toBe("Bank holiday");
    expect(payload.isAllDay).toBe(true);
  });

  it("returns null when no account of the given provider is connected", async () => {
    accounts.set("a1", { id: "a1", userId: "u1", provider: "google" });

    const { pushHolidayToCalendar } = await import("@/lib/calendar-push");
    const result = await pushHolidayToCalendar({
      userId: "u1",
      provider: "microsoft",
      title: "Something",
      description: null,
      startsOn: "2026-05-01",
      endsOn: null,
    });
    expect(result).toBeNull();
  });
});
