import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { getOrPickDailyPhoto } from "@/lib/daily-photo";

export const maxDuration = 60;

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const photo = await getOrPickDailyPhoto(ctx.householdId);
    if (!photo) {
      return NextResponse.json({ photo: null });
    }
    return NextResponse.json({
      photo: {
        url: `/api/today/photo/image?date=${photo.date}`,
        caption: photo.caption,
        contributor: photo.contributorName,
        takenAt: photo.takenAt,
        date: photo.date,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("daily photo fetch failed", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
