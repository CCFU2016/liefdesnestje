import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { syncCalendarEvents } from "@/lib/microsoft/sync";

/**
 * Pulls a delta sync for all of the caller's enabled calendars. Safe to
 * call on calendar page load — falls back to no-op if no accounts linked.
 */
export async function POST() {
  try {
    const ctx = await requireHouseholdMember();
    const accounts = await db
      .select()
      .from(externalCalendarAccounts)
      .where(eq(externalCalendarAccounts.userId, ctx.userId));

    let totalUpserted = 0;
    let totalRemoved = 0;
    for (const a of accounts) {
      if (a.provider !== "microsoft") continue; // Google: v1 stub
      const cals = await db
        .select()
        .from(calendars)
        .where(and(eq(calendars.accountId, a.id), eq(calendars.syncEnabled, true)));
      for (const c of cals) {
        try {
          const { upserted, removed } = await syncCalendarEvents(
            a.id,
            c.id,
            ctx.householdId,
            ctx.userId
          );
          totalUpserted += upserted;
          totalRemoved += removed;
        } catch (e) {
          console.error("sync failed for calendar", c.id, e);
        }
      }
    }
    return NextResponse.json({ upserted: totalUpserted, removed: totalRemoved });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
