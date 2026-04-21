import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { calendars, events, externalCalendarAccounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { syncCalendarEvents as msSync } from "@/lib/microsoft/sync";
import { syncCalendarEvents as gcalSync, unsubscribeCalendar as gcalUnsubscribe } from "@/lib/google/sync";
import { deleteSubscription as msDeleteSubscription } from "@/lib/microsoft/graph";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  syncEnabled: z.boolean().optional(),
});

async function loadForCaller(id: string, ctx: Awaited<ReturnType<typeof requireHouseholdMember>>) {
  const cal = (await db.select().from(calendars).where(eq(calendars.id, id)).limit(1))[0];
  if (!cal) return null;
  const account = (
    await db.select().from(externalCalendarAccounts).where(eq(externalCalendarAccounts.id, cal.accountId)).limit(1)
  )[0];
  if (!account) return null;
  // Only the owning user can modify their calendars; partners can see them but not change labels.
  if (account.userId !== ctx.userId) return null;
  return { cal, account };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const loaded = await loadForCaller(id, ctx);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const wasEnabled = loaded.cal.syncEnabled;

    const [updated] = await db
      .update(calendars)
      .set({
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.color !== undefined ? { color: body.data.color } : {}),
        ...(body.data.syncEnabled !== undefined ? { syncEnabled: body.data.syncEnabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, id))
      .returning();

    // If sync was just turned on, kick off an initial pull (don't await fully — best-effort).
    if (!wasEnabled && body.data.syncEnabled === true) {
      const run = async () => {
        try {
          const fn = loaded.account.provider === "microsoft" ? msSync : gcalSync;
          await fn(loaded.account.id, id, ctx.householdId, ctx.userId);
        } catch (e) {
          console.error("post-enable sync failed", e);
        }
      };
      queueMicrotask(run);
    }

    return NextResponse.json({ calendar: updated });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * Disconnect: stops syncing, removes the local calendar row + its events
 * (cascade), and stops the provider webhook subscription. Does NOT delete
 * anything in the source provider (Microsoft/Google).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const loaded = await loadForCaller(id, ctx);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Best-effort unsubscribe at the provider.
    try {
      if (loaded.cal.subscriptionId) {
        if (loaded.account.provider === "microsoft") {
          await msDeleteSubscription(loaded.account.id, loaded.cal.subscriptionId);
        } else if (loaded.account.provider === "google") {
          await gcalUnsubscribe(loaded.account.id, id);
        }
      }
    } catch (e) {
      console.warn("unsubscribe failed, continuing with local delete", e);
    }

    // Soft-delete events first for speed; cascade would drop them, but a soft
    // delete keeps the audit trail if we ever want it.
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.calendarId, id));
    await db.delete(calendars).where(eq(calendars.id, id));

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
