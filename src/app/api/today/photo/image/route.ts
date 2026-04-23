import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { photoOfTheDay } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Auth-gated serve for the day's cached photo. Path comes from the DB
// row rather than the client, so there's no traversal surface.
export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "bad date" }, { status: 400 });
    }
    const [row] = await db
      .select()
      .from(photoOfTheDay)
      .where(
        and(eq(photoOfTheDay.householdId, ctx.householdId), eq(photoOfTheDay.date, date))
      )
      .limit(1);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    const full = join(UPLOAD_ROOT, row.localPath);
    try {
      const st = await stat(full);
      if (!st.isFile()) return NextResponse.json({ error: "not a file" }, { status: 404 });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    const bytes = await readFile(full);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": row.mimeType,
        "cache-control": "private, max-age=21600", // 6h
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
