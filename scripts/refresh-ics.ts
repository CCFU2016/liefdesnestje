import "dotenv/config";

// Refresh all ICS subscriptions. Run every 6 hours on Railway cron:
// `0 */6 * * *` → `pnpm cron:refresh-ics`.

async function main() {
  const { refreshStaleIcs } = await import("../src/lib/ics/sync");
  // "stale" = older than 4 hours. With a 6-hour cron, each feed gets refreshed
  // at most every 6h (usually less), well inside the "at least twice per day"
  // bar.
  const result = await refreshStaleIcs(4 * 60 * 60 * 1000);
  console.log(`ICS refresh: ${result.refreshed} ok, ${result.failed} failed`);

  // Piggy-back housekeeping on this cron, but run it *inside the app*
  // (POST /api/internal/prune): the daily-photo files live on the app's
  // volume, and a cron service has its own empty one, so unlinking here
  // would remove the database rows and leave every file behind.
  // Needs APP_URL + CRON_SECRET on this service; skipped with a warning
  // otherwise. Never fails the refresh.
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) {
    console.warn("Prune skipped: APP_URL and CRON_SECRET must be set on this service");
    return;
  }
  try {
    const res = await fetch(new URL("/api/internal/prune", appUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(3 * 60 * 1000),
    });
    const p = (await res.json().catch(() => ({}))) as {
      photosDeleted?: number; photoFilesDeleted?: number; sessionsDeleted?: number;
      tokensDeleted?: number; usageRowsDeleted?: number; errors?: string[]; error?: string;
    };
    if (!res.ok && res.status !== 207) throw new Error(`app returned ${res.status}: ${p.error ?? "unknown"}`);
    console.log(
      `Prune: ${p.photosDeleted ?? 0} photos (${p.photoFilesDeleted ?? 0} files), ${p.sessionsDeleted ?? 0} sessions, ${p.tokensDeleted ?? 0} tokens, ${p.usageRowsDeleted ?? 0} usage rows` +
        (p.errors?.length ? `; errors: ${p.errors.join(" | ")}` : "")
    );
  } catch (e) {
    console.error("Prune failed:", e instanceof Error ? e.message : e);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
