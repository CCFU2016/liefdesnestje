import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, householdMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { syncCalendarEvents } from "@/lib/google/sync";
import { timingSafeEqualStr } from "@/lib/timing-safe-eq";

// Google Calendar push notifications.
// Headers sent by Google:
//   X-Goog-Channel-ID      (the channel id we created)
//   X-Goog-Channel-Token   (our WEBHOOK_SECRET — verify!)
//   X-Goog-Resource-ID     (the resource Google is watching)
//   X-Goog-Resource-State  (sync|exists|not_exists)
// Body is empty for most notifications. The 'sync' state is a confirmation
// sent once right after creating the channel — safe to ignore.

export async function POST(req: Request) {
  const state = req.headers.get("X-Goog-Resource-State");
  const channelId = req.headers.get("X-Goog-Channel-ID");
  const token = req.headers.get("X-Goog-Channel-Token");

  if (state === "sync") return NextResponse.json({ ok: true });

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !token || !timingSafeEqualStr(token, secret)) {
    console.warn("Google webhook: bad or missing token, ignoring");
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!channelId) return NextResponse.json({ error: "missing channel" }, { status: 400 });

  queueMicrotask(async () => {
    try {
      const cal = (
        await db.select().from(calendars).where(eq(calendars.subscriptionId, channelId)).limit(1)
      )[0];
      if (!cal || !cal.accountId) return;
      const account = (
        await db
          .select()
          .from(externalCalendarAccounts)
          .where(eq(externalCalendarAccounts.id, cal.accountId))
          .limit(1)
      )[0];
      if (!account) return;
      const membership = (
        await db.select().from(householdMembers).where(eq(householdMembers.userId, account.userId)).limit(1)
      )[0];
      if (!membership) return;
      await syncCalendarEvents(account.id, cal.id, membership.householdId, account.userId);
    } catch (e) {
      console.error("Google webhook processing failed", e);
    }
  });

  return NextResponse.json({ ok: true });
}
