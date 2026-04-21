import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { refreshIcsCalendar } from "@/lib/ics/sync";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = createSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    // webcal:// is the same as https:// for ICS — normalize
    let url = body.data.url.trim();
    if (url.startsWith("webcal://")) url = "https://" + url.slice("webcal://".length);

    const [created] = await db
      .insert(calendars)
      .values({
        householdId: ctx.householdId,
        sourceType: "ics",
        externalId: url, // use the URL as external ident; unique across accountId+externalId doesn't fire because accountId is null
        name: body.data.name,
        color: body.data.color ?? "#7c3aed",
        icsUrl: url,
        syncEnabled: true,
      })
      .returning();

    // Fire initial sync — best-effort, surface errors via lastError
    try {
      await refreshIcsCalendar(created.id);
    } catch (e) {
      console.error("initial ICS sync failed", e);
    }

    return NextResponse.json({ calendar: created });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
