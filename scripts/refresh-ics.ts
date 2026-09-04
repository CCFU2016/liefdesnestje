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

  // Piggy-back housekeeping on this cron: old daily photos + their files,
  // expired sessions, stale Claude usage rows. Never fails the refresh.
  try {
    const { pruneOldData } = await import("../src/lib/maintenance/prune");
    const p = await pruneOldData();
    console.log(
      `Prune: ${p.photosDeleted} photos (${p.photoFilesDeleted} files), ${p.sessionsDeleted} sessions, ${p.tokensDeleted} tokens, ${p.usageRowsDeleted} usage rows` +
        (p.errors.length ? `; errors: ${p.errors.join(" | ")}` : "")
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
