import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { refreshIcsCalendar } from "@/lib/ics/sync";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireHouseholdMember();
    const { id } = await params;

    const cal = (await db.select().from(calendars).where(eq(calendars.id, id)).limit(1))[0];
    if (!cal || cal.householdId !== ctx.householdId || cal.sourceType !== "ics") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await refreshIcsCalendar(id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
