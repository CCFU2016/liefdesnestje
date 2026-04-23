import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { getOrPickDailyPhoto } from "@/lib/daily-photo";

export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    console.log("[api/today/photo] user=", ctx.userId);
    const photo = await getOrPickDailyPhoto(ctx.householdId);
    if (!photo) {
      console.log("[api/today/photo] no photo returned — check [daily-photo] logs above");
      return NextResponse.json({ photo: null }, { headers: NO_STORE });
    }
    console.log("[api/today/photo] returning photo", photo.date, photo.photoGuid);
    return NextResponse.json(
      {
        photo: {
          url: `/api/today/photo/image?date=${photo.date}`,
          caption: photo.caption,
          contributor: photo.contributorName,
          takenAt: photo.takenAt,
          date: photo.date,
        },
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    }
    console.error("daily photo fetch failed", e);
    return NextResponse.json({ error: "Server error" }, { status: 500, headers: NO_STORE });
  }
}
