import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { trips, visitedPlaces } from "@/lib/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const stopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().max(120).nullable().optional(),
  countryCode: z.string().trim().length(2).toLowerCase().nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  // Shared metadata — when present it is applied to EVERY stop of the trip.
  visitedOn: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable().optional(),
  withPersons: z.array(z.string().uuid()).min(1).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  addStops: z.array(stopSchema).max(30).optional(),
  removePlaceIds: z.array(z.string().uuid()).max(50).optional(),
});

async function loadTrip(id: string, householdId: string) {
  const rows = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.householdId, householdId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const body = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const trip = await loadTrip(id, ctx.householdId);
    if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const stops = await db
      .select()
      .from(visitedPlaces)
      .where(and(eq(visitedPlaces.tripId, id), isNull(visitedPlaces.deletedAt)));

    // A trip can't end up with zero stops — remove the trip instead.
    const removeIds = (body.data.removePlaceIds ?? []).filter((rid) =>
      stops.some((s) => s.id === rid)
    );
    const remaining = stops.length - removeIds.length + (body.data.addStops?.length ?? 0);
    if (remaining < 1) {
      return NextResponse.json(
        { error: "A trip needs at least one stop — delete the trip instead." },
        { status: 400 }
      );
    }

    if (body.data.name !== undefined) {
      await db.update(trips).set({ name: body.data.name }).where(eq(trips.id, id));
    }

    // Shared metadata propagates to every (surviving) stop.
    const shared: Partial<typeof visitedPlaces.$inferInsert> = { updatedAt: new Date() };
    if (body.data.visitedOn !== undefined) shared.visitedOn = body.data.visitedOn;
    if (body.data.withPersons !== undefined) shared.withPersons = body.data.withPersons;
    if (body.data.notes !== undefined) shared.notes = body.data.notes || null;
    if (Object.keys(shared).length > 1) {
      await db
        .update(visitedPlaces)
        .set(shared)
        .where(and(eq(visitedPlaces.tripId, id), isNull(visitedPlaces.deletedAt)));
    }

    if (removeIds.length) {
      await db
        .update(visitedPlaces)
        .set({ deletedAt: new Date() })
        .where(inArray(visitedPlaces.id, removeIds));
    }

    if (body.data.addStops?.length) {
      // New stops inherit the trip's shared metadata (post-update values).
      const template = stops.find((s) => !removeIds.includes(s.id)) ?? stops[0];
      await db.insert(visitedPlaces).values(
        body.data.addStops.map((s) => ({
          householdId: ctx.householdId,
          authorId: ctx.userId,
          name: s.name,
          country: s.country ?? null,
          countryCode: s.countryCode ?? null,
          state: s.state ?? null,
          latitude: s.latitude,
          longitude: s.longitude,
          visitedOn: body.data.visitedOn !== undefined ? body.data.visitedOn : template.visitedOn,
          withPersons:
            body.data.withPersons !== undefined ? body.data.withPersons : template.withPersons,
          notes: body.data.notes !== undefined ? body.data.notes || null : template.notes,
          tripId: id,
        }))
      );
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

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const trip = await loadTrip(id, ctx.householdId);
    if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Soft-delete the pins, then drop the trip row itself.
    await db
      .update(visitedPlaces)
      .set({ deletedAt: new Date(), tripId: null })
      .where(eq(visitedPlaces.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
