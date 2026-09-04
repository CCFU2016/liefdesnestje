#!/bin/sh
# Dump Postgres + fetch the uploads archive from the app, push both to an
# S3-compatible bucket, and prune copies older than RETENTION_DAYS.
# Exits non-zero on any failure so Railway shows the cron run as failed.
set -eu

: "${DATABASE_URL:?DATABASE_URL is required (use the Postgres service's private URL)}"
: "${APP_URL:?APP_URL is required (e.g. https://liefdesnestje-production.up.railway.app)}"
: "${CRON_SECRET:?CRON_SECRET is required (same value as on the app service)}"
: "${BACKUP_REMOTE:?BACKUP_REMOTE is required (rclone path, e.g. r2:liefdesnestje-backups/prod)}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

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

echo "[backup] uploading to $BACKUP_REMOTE"
rclone copy "$WORK" "$BACKUP_REMOTE/" --s3-no-check-bucket
echo "[backup] pruning copies older than ${RETENTION_DAYS}d"
rclone delete "$BACKUP_REMOTE/" --min-age "${RETENTION_DAYS}d"

echo "[backup] done:"
ls -la "$WORK"
rclone ls "$BACKUP_REMOTE/" | tail -n 6
