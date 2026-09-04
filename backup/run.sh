#!/bin/sh
# Dump Postgres + fetch the uploads archive from the app, then keep copies
# under BACKUP_REMOTE and prune old ones. Exits non-zero on any failure so
# Railway shows the cron run as failed.
#
# BACKUP_REMOTE is an rclone destination. Two shapes are supported:
#   /backups                          a local path — a Railway volume mounted
#                                     on this service (no other account needed)
#   r2:liefdesnestje-backups/prod     an S3-compatible bucket configured via
#                                     RCLONE_CONFIG_<NAME>_* variables
# Layout under the destination: daily/ (kept DAILY_KEEP_DAYS) and weekly/
# (a copy every Sunday, kept WEEKLY_KEEP_DAYS).
set -eu

: "${DATABASE_URL:?DATABASE_URL is required (use the the Postgres service private URL)}"
: "${APP_URL:?APP_URL is required (e.g. https://liefdesnestje-production.up.railway.app)}"
: "${CRON_SECRET:?CRON_SECRET is required (same value as on the app service)}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE is required (/backups for a local volume, or an rclone remote path)}"
DAILY_KEEP_DAYS="${DAILY_KEEP_DAYS:-${RETENTION_DAYS:-7}}"
WEEKLY_KEEP_DAYS="${WEEKLY_KEEP_DAYS:-28}"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[backup] $STAMP dumping database"
pg_dump --no-owner --no-privileges --format=custom "$DATABASE_URL" > "$WORK/db-$STAMP.dump"
# A dump that cannot be listed cannot be restored — fail now, not on the day we need it.
pg_restore --list "$WORK/db-$STAMP.dump" > /dev/null

echo "[backup] fetching uploads archive from the app"
curl -fsS --retry 3 --retry-delay 10 --max-time 1800 \
  -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/internal/backup/uploads" -o "$WORK/uploads-$STAMP.tar.gz"
gzip -t "$WORK/uploads-$STAMP.tar.gz"

echo "[backup] copying to $BACKUP_REMOTE/daily (keeping ${DAILY_KEEP_DAYS}d)"
rclone copy "$WORK" "$BACKUP_REMOTE/daily/"
rclone delete "$BACKUP_REMOTE/daily/" --min-age "${DAILY_KEEP_DAYS}d" || true

# Sunday: also keep a weekly copy so a problem noticed late still has a
# restore point older than the daily window.
if [ "$(date -u +%u)" = "7" ]; then
  echo "[backup] Sunday: copying to $BACKUP_REMOTE/weekly (keeping ${WEEKLY_KEEP_DAYS}d)"
  rclone copy "$WORK" "$BACKUP_REMOTE/weekly/"
  rclone delete "$BACKUP_REMOTE/weekly/" --min-age "${WEEKLY_KEEP_DAYS}d" || true
fi

echo "[backup] done:"
ls -la "$WORK"
echo "[backup] destination now holds:"
rclone ls "$BACKUP_REMOTE/" | tail -n 12
rclone size "$BACKUP_REMOTE/" || true
