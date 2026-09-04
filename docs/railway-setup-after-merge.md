# Railway setup after merging the hardening PR

A click-by-click guide. Budget about 45 minutes, most of it waiting for deploys. Do the parts in order; each one is safe to stop after.

You will need: the Railway dashboard (railway.com, project **blissful-commitment**), a terminal (only for generating two random secrets), and for Part 3 a free Cloudflare account.

Already done for you: `ALLOWED_EMAILS` on the app service is set to the two existing accounts.

---

## Part 1 — The shared cron secret (5 min)

The app has two endpoints that only our own cron jobs may call (the nightly photo pick and the backup archive). They are protected by a password called `CRON_SECRET`. The app and every cron job that calls it must have the **same** value.

1. Open a terminal and run:

   ```sh
   openssl rand -hex 24
   ```

   It prints a 48-character string like `4f1c…9a`. Copy it. Keep this terminal window open; you will paste the value twice more.

2. In Railway, open the project → click the **liefdesnestje** service (the web app) → **Variables** tab.
3. Click **+ New Variable**.
   - Name: `CRON_SECRET`
   - Value: paste the string from step 1.
4. Click **Add**, then the purple **Deploy** button that appears at the top ("Apply 1 change"). Railway redeploys the app; wait until the deployment shows a green **Active** (about 2 minutes).

Check: in the service's **Deployments** tab → latest deployment → **View logs**. You should no longer see the line `[env] CRON_SECRET is not set`.

---

## Part 2 — Fix the "nightly photo" cron service (10 min)

Until now this job downloaded the photo onto its *own* disk, where the app could never find it. After the merge it only asks the app to do the work, so it needs to know the app's address and the secret.

1. In the project canvas, click the **nightly photo** service → **Variables** tab.
2. Add two variables (**+ New Variable** each time):

   | Name | Value |
   |---|---|
   | `APP_URL` | `https://liefdesnestje-production.up.railway.app` |
   | `CRON_SECRET` | the same string from Part 1 |

3. Click **Deploy** ("Apply 2 changes").
4. Remove the disk it no longer needs. On the canvas you will see a small volume box attached to the nightly photo service (named something like *nurturing-volume*). Click it → **Settings** → scroll down → **Delete Volume** → confirm. The job keeps nothing there that matters.
5. Do the same for the volume that is attached to nothing (named *valiant-volume*): click it → Settings → Delete Volume. It is only costing money.

   Do **not** touch *liefdesnestje-volume*, the one attached to the web app. That is where every document and photo lives.

Check: click the nightly photo service → **Settings** → under **Cron Schedule** make sure it still says `35 23 * * *`. Then trigger a run by hand: **Deployments** tab → the three-dots menu on the latest deployment → **Redeploy**. The log should end with `[prewarm-daily-photo] 1 album(s), 0 failed` (or `0 album(s)` if no photo album is configured).

---

## Part 3 — Nightly backups (25 min)

This is the important one. Right now the database and every uploaded file exist exactly once, on Railway. This part copies both, every night, to a bucket at Cloudflare that Railway cannot touch.

### 3a. Create a bucket at Cloudflare (10 min)

1. Go to <https://dash.cloudflare.com> and sign in (create a free account if needed; no domain or card required for R2's free tier).
2. In the left menu click **R2 Object Storage** → **Create bucket**.
   - Bucket name: `liefdesnestje-backups`
   - Location: leave *Automatic* (or pick *EU*).
   - Click **Create bucket**.
3. Back on the R2 overview page, on the right, note your **Account ID** (a 32-character hex string). Copy it somewhere; you need it in a moment.
4. Still on the R2 overview, click **Manage R2 API Tokens** (right side, under "Account details") → **Create API token**.
   - Token name: `liefdesnestje-backup`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): choose **Apply to specific buckets only** → tick `liefdesnestje-backups`.
   - TTL: *Forever*.
   - Click **Create API Token**.
5. Cloudflare now shows three values **once**. Copy all three into a temporary note:
   - **Access Key ID**
   - **Secret Access Key**
   - the **S3 endpoint**, which looks like `https://<accountid>.r2.cloudflarestorage.com`

   Click **Finish**. (If you lose them, delete the token and create a new one.)

### 3b. Create the backup service in Railway (10 min)

1. In the Railway project, click **+ Create** (top right) → **GitHub Repo** → pick **CCFU2016/liefdesnestje** → **Add service**. A new service appears; it will start building and **fail**. That is expected; keep going.
2. Click the new service → **Settings** tab:
   - Under **Service name** rename it to `backup`.
   - Under **Source** → **Root Directory**: enter `backup` → click the tick. (This makes Railway build only the `backup/` folder, which contains a Dockerfile; Railway detects it automatically.)
   - Under **Deploy** → **Cron Schedule**: enter `15 3 * * *` (every night at 03:15 UTC, after the photo job). Click the tick.
3. **Variables** tab. The quickest way is **Raw Editor** (button at the top right of the variables list). Paste the block below, then fill in the four values in angle brackets from your note, and click **Update Variables**.

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   APP_URL=https://liefdesnestje-production.up.railway.app
   CRON_SECRET=<the string from Part 1>
   BACKUP_REMOTE=r2:liefdesnestje-backups/prod
   RETENTION_DAYS=30
   RCLONE_CONFIG_R2_TYPE=s3
   RCLONE_CONFIG_R2_PROVIDER=Cloudflare
   RCLONE_CONFIG_R2_ACCESS_KEY_ID=<Access Key ID>
   RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<Secret Access Key>
   RCLONE_CONFIG_R2_ENDPOINT=<S3 endpoint, e.g. https://abc123….r2.cloudflarestorage.com>
   RCLONE_CONFIG_R2_ACL=private
   ```

   Notes:
   - `${{Postgres.DATABASE_URL}}` is a Railway *reference*: it copies the database address from the Postgres service, so it never goes stale. If your Postgres service has a different name, use that name instead of `Postgres`.
   - `BACKUP_REMOTE` must start with `r2:` because the `RCLONE_CONFIG_R2_*` variables define a storage connection called `R2`.

4. Click **Deploy** ("Apply changes"). Railway rebuilds the service with the Dockerfile (2–3 minutes the first time).

### 3c. Run it once by hand and check (5 min)

1. **Deployments** tab → three-dots menu on the latest deployment → **Redeploy**. A cron service runs its job when you redeploy it.
2. Open **View logs**. A good run ends with:

   ```
   [backup] done:
   -rw-r--r-- … db-2026-09-05T031500Z.dump
   -rw-r--r-- … uploads-2026-09-05T031500Z.tar.gz
   ```

   followed by a short file listing from the bucket.
3. Go back to Cloudflare → R2 → `liefdesnestje-backups` → folder `prod`. Both files should be there. The database dump is a few MB; the uploads archive a few hundred MB.

If the log instead says:

- `CRON_SECRET is required` or `401` → the secret on the backup service does not match the app's. Re-paste it on both.
- `404` from the app → the app is not yet running the merged code, or `APP_URL` is wrong.
- `AccessDenied` / `SignatureDoesNotMatch` from rclone → the R2 key, secret or endpoint is mistyped.
- `pg_dump: error: connection` → `DATABASE_URL` reference is wrong; open the Postgres service's Variables and copy its `DATABASE_URL` value directly instead of the reference.

### 3d. Put a restore drill in your calendar

Twice a year, follow the **Restore** section in `backup/README.md` against a scratch database. A backup nobody has ever restored is a hope, not a backup.

---

## Part 4 — Optional: health check (2 min)

1. **liefdesnestje** service → **Settings** → scroll to **Deploy** → **Healthcheck Path**: enter `/api/health` → tick.
2. From now on Railway only marks a deployment healthy once the app reports the database and the volume are reachable, and rolls back a deployment that cannot.

---

## Done

You should now have: two accounts allowed to sign in, a shared secret on three services, one volume on the web app only, a nightly backup in Cloudflare with a 30-day history, and a health check. Everything else in the PR needs no action.
