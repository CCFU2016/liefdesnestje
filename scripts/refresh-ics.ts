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
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
