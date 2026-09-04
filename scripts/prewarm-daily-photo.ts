import "dotenv/config";

// Pre-pick today's photo for every household, so the first person opening
// the app never waits out Apple's ~50 s album listing.
//
// Run shortly after Amsterdam midnight (Railway Cron, UTC): `35 23 * * *`
// → 00:35 CET / 01:35 CEST.
//
// This script no longer does the work itself. It used to import
// lib/daily-photo and download the file here — but each Railway service has
// its own volume, so the photo landed on the cron's volume, the app never
// found it, dropped the row and re-picked. Now we just ask the app to do it
// (POST /api/internal/daily-photo), which runs on the volume the app reads.
//
// Required env on the cron service: APP_URL (e.g. https://liefdesnestje-
// production.up.railway.app) and CRON_SECRET (same value as the app).

async function main() {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl) throw new Error("APP_URL is not set");
  if (!secret) throw new Error("CRON_SECRET is not set");

  const res = await fetch(new URL("/api/internal/daily-photo", appUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    albums?: number;
    failed?: number;
    results?: Array<{ householdId: string; ok: boolean; date?: string; ms: number; error?: string }>;
    error?: string;
  };
  if (!res.ok && res.status !== 207) {
    throw new Error(`app returned ${res.status}: ${body.error ?? "unknown error"}`);
  }
  for (const r of body.results ?? []) {
    console.log(
      `[prewarm-daily-photo] household ${r.householdId}: ${r.ok ? `ok ${r.date}` : `FAILED ${r.error}`} (${r.ms}ms)`
    );
  }
  console.log(`[prewarm-daily-photo] ${body.albums ?? 0} album(s), ${body.failed ?? 0} failed`);
  process.exit(body.failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[prewarm-daily-photo] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
