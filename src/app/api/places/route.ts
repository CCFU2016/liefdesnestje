import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { trips, visitedPlaces } from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const stopSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().max(120).nullable().optional(),
  countryCode: z.string().trim().length(2).toLowerCase().nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const createSchema = z.object({
  // One or more cities/places; several stops become one trip. Shared
  // metadata below applies to every stop.
  stops: z.array(stopSchema).min(1).max(30),
  tripName: z.string().trim().max(200).nullable().optional(),
  visitedOn: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).nullable().optional(),
  withPersons: z.array(z.string().uuid()).min(1),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const places = await db
      .select()
      .from(visitedPlaces)
      .where(and(eq(visitedPlaces.householdId, ctx.householdId), isNull(visitedPlaces.deletedAt)))
      .orderBy(desc(visitedPlaces.visitedOn));

    // Decorate with trip names so pins and the tracker can say
    // "part of Roadtrip USA 2019".
    const tripIds = [...new Set(places.map((p) => p.tripId).filter(Boolean))] as string[];
    const tripRows = tripIds.length
      ? await db.select().from(trips).where(inArray(trips.id, tripIds))
      : [];
    const tripNameById = new Map(tripRows.map((t) => [t.id, t.name]));

    return NextResponse.json({
      places: places.map((p) => ({
        ...p,
        tripName: p.tripId ? (tripNameById.get(p.tripId) ?? null) : null,
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { stops, tripName, visitedOn, withPersons, notes } = body.data;

    // A trip row exists when there are several stops or an explicit name.
    let tripId: string | null = null;
    if (stops.length > 1 || tripName) {
      const [trip] = await db
        .insert(trips)
        .values({
          householdId: ctx.householdId,
          authorId: ctx.userId,
          name: tripName || stops.map((s) => s.name).join(" – "),
        })
        .returning();
      tripId = trip.id;
    }

    const inserted = await db
      .insert(visitedPlaces)
      .values(
        stops.map((s) => ({
          householdId: ctx.householdId,
          authorId: ctx.userId,
          name: s.name,
          country: s.country ?? null,
          countryCode: s.countryCode ?? null,
          state: s.state ?? null,
          latitude: s.latitude,
          longitude: s.longitude,
          visitedOn: visitedOn ?? null,
          withPersons,
          notes: notes || null,
          tripId,
        }))
      )
      .returning();
    return NextResponse.json({ places: inserted }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
