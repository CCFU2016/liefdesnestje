import "dotenv/config";
import { db } from "../src/lib/db";
import { householdPhotoAlbums } from "../src/lib/db/schema";
import { getOrPickDailyPhoto } from "../src/lib/daily-photo";

// Pre-pick today's photo for every household with a configured album, so the
// first person opening the app never waits out Apple's ~50s album listing.
//
// Run shortly after Amsterdam midnight (Railway Cron, UTC): `35 23 * * *`
// → 00:35 CET / 01:35 CEST. Requires NODE_OPTIONS=--conditions=react-server
// (see package.json) so the `server-only` guard inside lib/daily-photo
// resolves to its no-op build outside Next.

async function main() {
  const albums = await db.select().from(householdPhotoAlbums);
  console.log(`[prewarm-daily-photo] ${albums.length} album(s) configured`);

  let failures = 0;
  for (const album of albums) {
    const started = Date.now();
    try {
      const photo = await getOrPickDailyPhoto(album.householdId);
      if (photo) {
        console.log(
          `[prewarm-daily-photo] household ${album.householdId}: ${photo.date} guid=${photo.photoGuid} (${Date.now() - started}ms)`
        );
      } else {
        failures++;
        console.warn(
          `[prewarm-daily-photo] household ${album.householdId}: no photo (check lastError in settings)`
        );
      }
    } catch (e) {
      failures++;
      console.error(
        `[prewarm-daily-photo] household ${album.householdId} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  // pglite/postgres keep handles open — exit explicitly, signalling failures.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[prewarm-daily-photo] fatal:", e);
  process.exit(1);
});
