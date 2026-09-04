import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { holidays, householdMembers, travelReservations } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError, isVisibleTo } from "@/lib/auth/household";
import { httpOrAppUrl, httpUrl } from "@/lib/validation";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";
import { isValidTimeZone } from "@/lib/timezones";

// IANA zone id, validated against the runtime's tz database.
const timeZoneSchema = z.string().max(64).refine(isValidTimeZone, { message: "Unknown time zone" });

const reservationKinds = [
  "hotel",
  "flight",
  "train",
  "car_rental",
  "ferry",
  "transit",
  "other",
] as const;

const patchSchema = z.object({
  kind: z.enum(reservationKinds).optional(),
  title: z.string().min(1).max(300).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  startTz: timeZoneSchema.nullable().optional(),
  endTz: timeZoneSchema.nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  confirmationCode: z.string().max(100).nullable().optional(),
  referenceUrl: httpUrl.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  origin: z.string().max(200).nullable().optional(),
  destination: z.string().max(200).nullable().optional(),
  // Either an external link or our own /api/holidays/<id>/travel/document?… path.
  documentUrl: httpOrAppUrl.max(500).nullable().optional(),
  travelerUserIds: z.array(z.string().uuid()).max(200).optional(),
});

async function loadForCaller(
  holidayId: string,
  rid: string,
  ctx: Awaited<ReturnType<typeof requireHouseholdMember>>
) {
  const h = (await db.select().from(holidays).where(eq(holidays.id, holidayId)).limit(1))[0];
  if (!h || h.householdId !== ctx.householdId || h.deletedAt) return null;
  if (!isVisibleTo(h, ctx)) return null;
  const r = (
    await db.select().from(travelReservations).where(eq(travelReservations.id, rid)).limit(1)
  )[0];
  if (!r || r.holidayId !== holidayId || r.deletedAt) return null;
  return { holiday: h, reservation: r };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> }
) {
  try {
    const ctx = await requireHouseholdMember();
    const { id, rid } = await params;
    const loaded = await loadForCaller(id, rid, ctx);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    if (body.data.travelerUserIds?.length) {
      const valid = await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, ctx.householdId),
            inArray(householdMembers.userId, body.data.travelerUserIds)
          )
        );
      if (valid.length !== body.data.travelerUserIds.length) {
        return NextResponse.json(
          { error: "travelerUserIds must belong to this household" },
          { status: 400 }
        );
      }
    }

    const update: Partial<typeof travelReservations.$inferInsert> = { updatedAt: new Date() };
    if (body.data.kind !== undefined) update.kind = body.data.kind;
    if (body.data.title !== undefined) update.title = body.data.title;
    if (body.data.startAt !== undefined) update.startAt = new Date(body.data.startAt);
    if (body.data.endAt !== undefined) update.endAt = body.data.endAt ? new Date(body.data.endAt) : null;
    if (body.data.startTz !== undefined) update.startTz = body.data.startTz;
    if (body.data.endTz !== undefined) update.endTz = body.data.endTz;
    if (body.data.location !== undefined) update.location = body.data.location;
    if (body.data.confirmationCode !== undefined) update.confirmationCode = body.data.confirmationCode;
    if (body.data.referenceUrl !== undefined) update.referenceUrl = body.data.referenceUrl;
    if (body.data.notes !== undefined) update.notes = body.data.notes;
    if (body.data.origin !== undefined) update.origin = body.data.origin;
    if (body.data.destination !== undefined) update.destination = body.data.destination;
    if (body.data.documentUrl !== undefined) update.documentUrl = body.data.documentUrl;
    if (body.data.travelerUserIds !== undefined) update.travelerUserIds = body.data.travelerUserIds;

    const [updated] = await db
      .update(travelReservations)
      .set(update)
      .where(eq(travelReservations.id, rid))
      .returning();
    return NextResponse.json({ reservation: updated });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; rid: string }> }
) {
  try {
    const ctx = await requireHouseholdMember();
    const { id, rid } = await params;
    const loaded = await loadForCaller(id, rid, ctx);
    if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db
      .update(travelReservations)
      .set({ deletedAt: new Date() })
      .where(eq(travelReservations.id, rid));

    // If that was the last reservation, clear hasTravel.
    const remaining = await db
      .select({ id: travelReservations.id })
      .from(travelReservations)
      .where(and(eq(travelReservations.holidayId, id), isNull(travelReservations.deletedAt)));
    if (remaining.length === 0) {
      await db.update(holidays).set({ hasTravel: false, updatedAt: new Date() }).where(eq(holidays.id, id));
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
