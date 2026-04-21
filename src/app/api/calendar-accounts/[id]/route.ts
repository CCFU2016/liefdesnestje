import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts, events } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { decrypt } from "@/lib/auth/encryption";
import { deleteSubscription as msDeleteSubscription } from "@/lib/microsoft/graph";
import { stopChannel as gcalStopChannel } from "@/lib/google/api";

/**
 * Disconnect a calendar account entirely.
 * - Revokes Google tokens (Microsoft has no standard revoke endpoint).
 * - Stops every active webhook subscription belonging to this account.
 * - Soft-deletes all events for the account's calendars.
 * - Deletes calendars (cascades from our schema) and the account row.
 *
 * Nothing is deleted in the source provider — only the link is severed.
 * The user can re-add the account later; they'll be asked to consent again.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;

    const account = (
      await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, id)).limit(1)
    )[0];
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (account.userId !== ctx.userId) {
      return NextResponse.json({ error: "Not yours to disconnect" }, { status: 403 });
    }

    // Stop every subscription before nuking the account (best-effort).
    const cals = await db.select().from(calendars).where(eq(calendars.accountId, account.id));
    for (const c of cals) {
      if (!c.subscriptionId) continue;
      try {
        if (account.provider === "microsoft") {
          await msDeleteSubscription(account.id, c.subscriptionId);
        } else if (account.provider === "google" && c.subscriptionResourceId) {
          await gcalStopChannel(account.id, c.subscriptionId, c.subscriptionResourceId);
        }
      } catch (e) {
        console.warn(`failed to stop ${account.provider} subscription for`, c.name, e);
      }
    }

    // Revoke at the provider (only Google has a standard endpoint).
    if (account.provider === "google") {
      try {
        const token = decrypt(account.refreshTokenEnc);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
      } catch (e) {
        console.warn("google token revoke failed, continuing", e);
      }
    }

    // Soft-delete events (cascade would hard-delete; soft keeps audit trail)
    for (const c of cals) {
      await db.update(events).set({ deletedAt: new Date() }).where(eq(events.calendarId, c.id));
    }
    // Cascade deletes calendars via FK; explicit delete is clearer though.
    await db.delete(calendars).where(eq(calendars.accountId, account.id));
    await db.delete(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, account.id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
