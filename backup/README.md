# Nightly backup

The app keeps its data in two places that each exist exactly once: the
Railway Postgres service and the `liefdesnestje-volume` mounted at `/data`
(travel tickets, event documents, avatars, daily photos). This folder is a
small cron service that copies both, every night, to a bucket outside
Railway.

What it does (`run.sh`):

1. `pg_dump` in custom format, then `pg_restore --list` to prove the dump is
   readable.
2. `GET $APP_URL/api/internal/backup/uploads` with the shared `CRON_SECRET`
   — the app streams a `tar.gz` of the uploads volume (only the app service
   has that volume mounted, so the app has to be the one to read it).
3. `rclone copy` both files to `BACKUP_REMOTE`, then delete copies older
   than `RETENTION_DAYS` (default 30).

## One-time setup

**1. A bucket.** Any S3-compatible store works; Cloudflare R2 has a free
10 GB tier and no egress fees. Create a bucket (e.g. `liefdesnestje-backups`)
and an API token with object read/write on that bucket. Note the account's
S3 endpoint: `https://<accountid>.r2.cloudflarestorage.com`.

**2. A secret shared with the app.** Generate one with `openssl rand -hex 24`
and set it as `CRON_SECRET` on the **app** service (Railway → liefdesnestje →
Variables) and on this service. The app also uses it for the daily-photo
prewarm endpoint.

**3. The Railway service.** In the project: *New → GitHub repo* (same repo),
then in the service settings:

- Root directory: `backup`
- Builder: Dockerfile (auto-detected from `backup/Dockerfile`)
- Cron schedule: `15 3 * * *` (03:15 UTC, after the photo prewarm)
- Variables:

  | Variable | Value |
  |---|---|
  | `DATABASE_URL` | reference the Postgres service's `DATABASE_URL` (private URL) |
  | `APP_URL` | `https://liefdesnestje-production.up.railway.app` |
  | `CRON_SECRET` | the value from step 2 |
  | `BACKUP_REMOTE` | `r2:liefdesnestje-backups/prod` |
  | `RETENTION_DAYS` | `30` |
  | `RCLONE_CONFIG_R2_TYPE` | `s3` |
  | `RCLONE_CONFIG_R2_PROVIDER` | `Cloudflare` |
  | `RCLONE_CONFIG_R2_ACCESS_KEY_ID` | from the R2 token |
  | `RCLONE_CONFIG_R2_SECRET_ACCESS_KEY` | from the R2 token |
  | `RCLONE_CONFIG_R2_ENDPOINT` | `https://<accountid>.r2.cloudflarestorage.com` |
  | `RCLONE_CONFIG_R2_ACL` | `private` |

  (For Backblaze B2 or AWS S3 change `PROVIDER`/`ENDPOINT`; rclone reads any
  remote named `R2` from `RCLONE_CONFIG_R2_*` variables, no config file needed.)

**4. Run it once by hand** (*Deploy → Run now*) and check the log ends with
`[backup] done:` and a listing that shows both files. Then set a calendar
reminder to do a restore drill twice a year.

## Restore

Download the two newest objects from the bucket (Cloudflare dashboard or
`rclone copy r2:liefdesnestje-backups/prod/<file> .`).

Database (this replaces the current contents — take a fresh dump first):

```sh
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$DATABASE_PUBLIC_URL" db-<stamp>.dump
```

Uploads, into the app's volume:

```sh
# from your machine: put the archive somewhere the app can fetch it (a
# presigned bucket URL works), then in a Railway shell on the app service:
railway ssh --service liefdesnestje
curl -fsSL "<presigned-url>" | tar -xzf - -C /data/uploads
```

Both are idempotent: restoring the same archive twice is harmless.
