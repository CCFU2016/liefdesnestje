import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { holidays, householdMembers, travelReservations } from "@/lib/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

const reservationKinds = [
  "hotel",
  "flight",
  "train",
  "car_rental",
  "ferry",
  "transit",
  "other",
] as const;

const createSchema = z.object({
  kind: z.enum(reservationKinds).default("other"),
  title: z.string().min(1).max(300),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  confirmationCode: z.string().max(100).nullable().optional(),
  referenceUrl: z.string().url().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  origin: z.string().max(200).nullable().optional(),
  destination: z.string().max(200).nullable().optional(),
  documentUrl: z.string().max(500).nullable().optional(),
  travelerUserIds: z.array(z.string().uuid()).default([]),
});

async function loadHolidayForCaller(
  holidayId: string,
  ctx: Awaited<ReturnType<typeof requireHouseholdMember>>
) {
  const h = (await db.select().from(holidays).where(eq(holidays.id, holidayId)).limit(1))[0];
  if (!h || h.householdId !== ctx.householdId || h.deletedAt) return null;
  if (h.visibility === "private" && h.authorId !== ctx.userId) return null;
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadHolidayForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(travelReservations)
      .where(and(eq(travelReservations.holidayId, id), isNull(travelReservations.deletedAt)))
      .orderBy(asc(travelReservations.startAt));
    return NextResponse.json({ reservations: rows });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;
    const h = await loadHolidayForCaller(id, ctx);
    if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) {
      return NextResponse.json({ error: "Invalid input", detail: body.error.issues }, { status: 400 });
    }

    // Validate traveler ids belong to the household.
    if (body.data.travelerUserIds.length) {
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

    const [created] = await db
      .insert(travelReservations)
      .values({
        householdId: ctx.householdId,
        holidayId: id,
        kind: body.data.kind,
        title: body.data.title,
        startAt: new Date(body.data.startAt),
        endAt: body.data.endAt ? new Date(body.data.endAt) : null,
        location: body.data.location ?? null,
        confirmationCode: body.data.confirmationCode ?? null,
        referenceUrl: body.data.referenceUrl ?? null,
        notes: body.data.notes ?? null,
        origin: body.data.origin ?? null,
        destination: body.data.destination ?? null,
        documentUrl: body.data.documentUrl ?? null,
        travelerUserIds: body.data.travelerUserIds,
      })
      .returning();

    // Auto-flip has_travel on the holiday so a fresh reservation enables
    // the section without requiring a second round-trip from the UI.
    if (!h.hasTravel) {
      await db.update(holidays).set({ hasTravel: true, updatedAt: new Date() }).where(eq(holidays.id, id));
    }

    return NextResponse.json({ reservation: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
