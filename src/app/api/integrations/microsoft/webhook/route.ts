import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, householdMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncCalendarEvents } from "@/lib/microsoft/sync";

// Microsoft Graph webhook endpoint.
// - Initial validation: Graph does GET/POST with ?validationToken=... — echo it back plain-text within 10s.
// - Notification payload: { value: [{ subscriptionId, clientState, resource, ... }] }.
//   We verify clientState against WEBHOOK_SECRET and kick off a delta sync.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, { status: 200, headers: { "content-type": "text/plain" } });
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error("WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  let payload: { value?: Array<{ subscriptionId: string; clientState?: string; resource?: string }> };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // Accept fast, process in background
  queueMicrotask(async () => {
    for (const n of payload.value ?? []) {
      if (!n.clientState || n.clientState !== secret) {
        console.warn("MS webhook: bad clientState, ignoring");
        continue;
      }
      try {
        const cal = (
          await db.select().from(calendars).where(eq(calendars.subscriptionId, n.subscriptionId)).limit(1)
        )[0];
        if (!cal) continue;
        const account = (
          await db
            .select()
            .from(externalCalendarAccounts)
            .where(eq(externalCalendarAccounts.id, cal.accountId))
            .limit(1)
        )[0];
        if (!account) continue;
        const membership = (
          await db.select().from(householdMembers).where(eq(householdMembers.userId, account.userId)).limit(1)
        )[0];
        if (!membership) continue;
        await syncCalendarEvents(account.id, cal.id, membership.householdId, account.userId);
      } catch (e) {
        console.error("MS webhook processing failed", e);
      }
    }
  });

  return NextResponse.json({ ok: true });
}
