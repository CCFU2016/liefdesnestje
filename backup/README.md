# Nightly backup

The app keeps its data in two places that each exist exactly once: the
Railway Postgres service and the `liefdesnestje-volume` mounted at `/data`
(travel tickets, event documents, avatars, daily photos). This folder is a
small cron service that copies both every night.

What it does (`run.sh`):

1. `pg_dump` in custom format, then `pg_restore --list` to prove the dump is
   readable.
2. `GET $APP_URL/api/internal/backup/uploads` with the shared `CRON_SECRET`
   — the app streams a `tar.gz` of the uploads volume (only the app service
   has that volume mounted, so the app has to be the one to read it).
3. `rclone copy` both files to `BACKUP_REMOTE/daily/` (kept 7 days) and, on
   Sundays, to `BACKUP_REMOTE/weekly/` (kept 28 days).

## Where the copies go

`BACKUP_REMOTE` is an rclone destination, so the same script serves two setups:

**A. A Railway volume on the backup service (current setup).** `BACKUP_REMOTE=/backups`
and a volume mounted at `/backups`. No other account is needed. This protects
against the likely disasters — a bad migration, an accidental delete, a
corrupt volume — but not against losing the Railway account itself, since the
copies live in the same account. Railway's own volume snapshots would be the
zero-effort alternative, but they need the Pro plan.

**B. An off-site bucket.** Any S3-compatible store (Cloudflare R2 has a free
10 GB tier; Backblaze B2 and AWS S3 also work). Set `BACKUP_REMOTE=r2:<bucket>/prod`
and the connection via variables, no config file needed:

| Variable | Value |
|---|---|
| `RCLONE_CONFIG_R2_TYPE` | `s3` |
| `RCLONE_CONFIG_R2_PROVIDER` | `Cloudflare` (or `AWS`, `Backblaze`) |
| `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | from the bucket's API token |
| `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | from the bucket's API token |
| `RCLONE_CONFIG_R2_ENDPOINT` | e.g. `https://<accountid>.r2.cloudflarestorage.com` |
| `RCLONE_CONFIG_R2_ACL` | `private` |

Switching from A to B later is only these variables plus `BACKUP_REMOTE`.

## The Railway service

Built from this folder (`Root Directory: backup`, Dockerfile auto-detected),
cron schedule `15 3 * * *` (03:15 UTC, after the photo prewarm). Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Postgres service) |
| `APP_URL` | `https://liefdesnestje-production.up.railway.app` |
| `CRON_SECRET` | same value as on the app service |
| `BACKUP_REMOTE` | `/backups` |
| `DAILY_KEEP_DAYS` | `7` |
| `WEEKLY_KEEP_DAYS` | `28` |

Run it by hand with *Redeploy* on its latest deployment; the log should end
with `[backup] done:` and a listing of `daily/` (and `weekly/` on Sundays).
Do a restore drill twice a year — a backup nobody has restored is a hope,
not a backup.

## Restore

Get the two files you need out of the backup volume:

```sh
railway volume files --volume backup-volume list /daily
railway volume files --volume backup-volume download /daily/db-<stamp>.dump .
railway volume files --volume backup-volume download /daily/uploads-<stamp>.tar.gz .
```

(The backup service must be running for the file browser to connect — start a
run with *Redeploy* first if it is idle; or read them from a `railway ssh`
shell on the backup service while a run is in progress.)

Database (this replaces the current contents — take a fresh dump first):

```sh
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$DATABASE_PUBLIC_URL" db-<stamp>.dump
```

Uploads, into the app's volume:

```sh
railway volume files --volume liefdesnestje-volume upload uploads-<stamp>.tar.gz /uploads-restore.tar.gz
railway ssh --service liefdesnestje -- sh -c "tar -xzf /data/uploads-restore.tar.gz -C /data/uploads && rm /data/uploads-restore.tar.gz"
```

Both are idempotent: restoring the same archive twice is harmless.
