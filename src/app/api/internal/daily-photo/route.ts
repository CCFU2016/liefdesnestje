import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { householdPhotoAlbums } from "@/lib/db/schema";
import { getOrPickDailyPhoto } from "@/lib/daily-photo";
import { requireCronSecret } from "@/lib/auth/cron";

// Pre-pick today's photo for every household with an album, so the first
// person opening the app never waits out Apple's ~50 s album listing.
//
// Called by the "nightly photo" Railway cron service (scripts/
// prewarm-daily-photo.ts) shortly after Amsterdam midnight. It runs here,
// inside the app, because only the app service has the uploads volume
// mounted — a file downloaded by the cron process would land on the cron's
// own volume and the app would never find it.
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const albums = await db.select().from(householdPhotoAlbums);
  const results: Array<{ householdId: string; ok: boolean; date?: string; ms: number; error?: string }> = [];

  for (const album of albums) {
    const started = Date.now();
    try {
      const photo = await getOrPickDailyPhoto(album.householdId);
      results.push({
        householdId: album.householdId,
        ok: !!photo,
        date: photo?.date,
        ms: Date.now() - started,
        error: photo ? undefined : "no photo picked (see lastError in Settings)",
      });
    } catch (e) {
      results.push({
        householdId: album.householdId,
        ok: false,
        ms: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`[daily-photo] prewarm: ${results.length - failed}/${results.length} ok`);
  return NextResponse.json({ albums: results.length, failed, results }, { status: failed ? 207 : 200 });
}
