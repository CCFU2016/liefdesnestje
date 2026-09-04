# Liefdesnestje

Shared home hub for you and your partner — calendar, to-dos, notes, trips, all in one place.

- **Stack:** Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn-style primitives + Drizzle ORM + Postgres + Auth.js v5 (Google) + Microsoft Graph (calendar) + Tiptap (notes) + react-big-calendar + Claude API (recipe extraction + ingredient aggregation) + SWR polling for real-time
- **Package manager:** pnpm
- **Deploy target:** Railway (single Next.js service + Railway Postgres + optional Volume for uploads)

## Quick start (local)

```bash
pnpm install
cp .env.example .env   # fill in values (see below)

# Postgres — local or Railway. If local:
docker run -d --name lnest-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

pnpm db:migrate       # apply migrations
pnpm dev              # http://localhost:3000
```

## Environment variables

See `.env.example`. Required:

| Var | What | How to get it |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | Railway plugin (auto) or local Docker |
| `AUTH_SECRET` | Auth.js session signing key | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth for sign-in | Google Cloud Console → Credentials |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT_ID` | Microsoft Graph calendar | Azure Portal → App registrations |
| `ENCRYPTION_KEY` | AES-256-GCM key for OAuth tokens at rest | `openssl rand -hex 32` (32 bytes / 64 hex chars) |
| `WEBHOOK_SECRET` | Shared secret used in Graph subscription clientState | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Claude API (recipe extraction + aggregation, v2) | console.anthropic.com → API keys |
| `NEXT_PUBLIC_APP_URL` | Base URL | `http://localhost:3000` locally |
| `ALLOWED_EMAILS` | Who may create an account (comma-separated) | your two Google addresses; see *Who can sign in* below |
| `CRON_SECRET` | Shared secret for the internal cron endpoints (daily photo, backup) | `openssl rand -hex 24`; same value on the cron services |

The server refuses to start in production if any of `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ENCRYPTION_KEY`, `WEBHOOK_SECRET` is missing or malformed (see `src/instrumentation.ts`); the optional ones only log a warning naming the feature that is off.

### Who can sign in

Any Google account can complete the OAuth flow, so the app decides afterwards (`src/lib/auth/allowlist.ts`):

1. an account that already exists always gets in;
2. otherwise the address must be listed in `ALLOWED_EMAILS`;
3. on a completely empty database the first sign-in is allowed (bootstrap).

To invite someone: add their address to `ALLOWED_EMAILS`, redeploy, then send them the household invite link from Settings.

## Google Cloud Console setup (sign-in)

1. Create a project → *APIs & services → Credentials → Create OAuth client ID*.
2. Application type: **Web application**.
3. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-railway-subdomain>.up.railway.app/api/auth/callback/google`
4. Copy the client ID/secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

### Enabling Google Calendar sync

The same GCP project + OAuth client works for both sign-in and calendar — just two extra steps:

1. **APIs & Services → Library** → enable **Google Calendar API**.
2. **Credentials → your OAuth client → Authorized redirect URIs** → add:
   - `http://localhost:3000/api/integrations/google/callback`
   - `https://<railway-domain>/api/integrations/google/callback`

Then in Settings, the **Connect Google calendar** button will run the OAuth dance with the `calendar` scope and start syncing.

Webhook push notifications for Google require a **verified domain** (Google Search Console) and HTTPS. On localhost we fall back to polling every 30s — fine for dev. In production, once your Railway domain is verified, subscriptions are created automatically on reconnect.

## Microsoft Azure setup (calendar sync)

1. [portal.azure.com](https://portal.azure.com) → *Entra ID → App registrations → New registration*.
2. Redirect URI (Web): `http://localhost:3000/api/integrations/microsoft/callback` (add the Railway equivalent later).
3. *API permissions → Add → Microsoft Graph → Delegated*: `Calendars.ReadWrite`, `offline_access`, `User.Read`. Click **Grant admin consent** if prompted.
4. *Certificates & secrets → New client secret*. Copy the value (not the ID) into `MS_CLIENT_SECRET`.
5. `MS_CLIENT_ID` = the app's Application (client) ID on the Overview page.
6. `MS_TENANT_ID` = `common` for multi-tenant personal accounts, or your tenant ID for work accounts.

### Webhooks for calendar push notifications

Microsoft Graph pushes calendar changes to `/api/integrations/microsoft/webhook`. This URL must be publicly reachable. For local dev, use a tunnel:

```bash
# Cloudflare Tunnel (free)
cloudflared tunnel --url http://localhost:3000
# or ngrok
ngrok http 3000
```

Set `NEXT_PUBLIC_APP_URL` to the tunnel URL while testing. The subscription renewal cron must also reach Graph.

Subscriptions expire after ~70 hours. Run the renewal cron every 6 hours:

```bash
pnpm cron:renew-subscriptions
```

On Railway: add a **Cron** service → schedule `0 */6 * * *` → command `pnpm cron:renew-subscriptions`.

## Deploying to Railway

1. New project → **Add plugin → PostgreSQL**.
2. **Add service → Deploy from GitHub** → pick this repo. Railway injects `DATABASE_URL` automatically.
3. Set the other env vars (see table above).
4. Railway auto-detects Next.js. The build command `pnpm build` and start `pnpm start` are picked up from `package.json`.
5. Add a **Volume** mounted at `/data` and set `UPLOAD_DIR=/data/uploads`. Every uploaded file (event documents, travel tickets, avatars, daily photos) lives there and nowhere else — which is why step 7 exists.
6. Add three **Cron services** pointing at the same repo. They share the database but **not** the volume, so none of them may write files:
   - `pnpm cron:renew-subscriptions` on `0 */6 * * *` — renews Microsoft/Google webhook subscriptions (recreates one that Graph dropped).
   - `pnpm cron:refresh-ics` on `0 */6 * * *` — refreshes every ICS subscription and runs housekeeping (old daily photos, expired sessions, Claude usage rows).
   - `pnpm cron:daily-photo` on `35 23 * * *` — asks the app (`POST /api/internal/daily-photo`) to pre-pick tomorrow's photo; needs `APP_URL` and `CRON_SECRET`.
7. Add the **backup** service (click-by-click walkthrough of this and the other post-merge steps: [`docs/railway-setup-after-merge.md`](docs/railway-setup-after-merge.md)): a fourth cron built from `backup/Dockerfile` that dumps Postgres and the uploads volume to an off-site bucket every night. Setup and restore steps are in [`backup/README.md`](backup/README.md). Do this before you trust the app with anything you would miss.
8. Update your Azure app's redirect URIs + `NEXT_PUBLIC_APP_URL` to the Railway subdomain.
9. Migrations run automatically on every start (`pnpm start` = `db:migrate && next start`). `GET /api/health` reports whether the database and the volume are reachable; point Railway's health check or an external pinger at it.

## Data model (v1)

```
users ── accounts/sessions (Auth.js)
  │
  └── household_members ── households ─┬── events ── calendars ── external_calendar_accounts
                                        ├── todo_lists ── todos
                                        ├── notes
                                        ├── trips ── trip_items
                                        └── household_invites
```

All household-scoped queries go through `requireHouseholdMember()` in `src/lib/auth/household.ts`. Private items are further filtered by `authorId`. OAuth refresh tokens are AES-256-GCM encrypted (see `src/lib/auth/encryption.ts`).

Timestamps are UTC in Postgres; per-event timezone is metadata.

## Real-time

SWR polls every 5s (todos), 10s (notes), 30s (calendar). Microsoft Graph push notifications keep the calendar data fresh between polls.

If polling ever feels sluggish, we can upgrade to Postgres `LISTEN/NOTIFY` + SSE. See `src/lib/db/index.ts` for where that would plug in.

## Testing

```bash
pnpm test            # Vitest unit tests
pnpm typecheck       # TypeScript
pnpm e2e             # Playwright (requires test DB + seeded users; see tests/e2e/todo-sync.spec.ts)
```

## Scripts

| | |
| --- | --- |
| `pnpm dev` | Start Next.js dev server |
| `pnpm build` / `pnpm start` | Production build + serve |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm check` | typecheck + lint + unit tests (what CI runs, plus a build) |
| `pnpm db:migrate` | Apply pending migrations (hand-written SQL in `drizzle/`, see below) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm test` | Vitest once |
| `pnpm e2e` | Playwright |
| `pnpm cron:renew-subscriptions` | Refresh Graph/Google webhook subscriptions |
| `pnpm cron:refresh-ics` | Re-pull all ICS subscriptions + housekeeping (runs every 6h in prod) |
| `pnpm cron:daily-photo` | Ask the app to pre-pick today's photo (nightly in prod) |

### Migrations

Migrations are hand-written SQL files in `drizzle/NNNN_name.sql`, registered in `drizzle/meta/_journal.json`, and applied by `scripts/migrate.ts` on every start (transactionally on Postgres). Use `ADD COLUMN IF NOT EXISTS` and friends so a re-run is harmless. The `drizzle-kit generate`/`push` commands were removed on purpose: the snapshots stopped at 0006 and `push` would happily diff production.

## v2 features

- **Meals** — shared weekly meal plan (dinner only), recipe book with 4 extraction sources (manual, photo, URL, TikTok/Instagram), cook mode with Wake Lock, and a Claude-powered "Generate shopping list" button that aggregates ingredients across the week and pushes them into the Groceries todo list. Rate-limited to 20 extraction calls per user per day.
- **Holidays** — countdown-styled list of upcoming trips/days-off, per-person tagging, document uploads (PDF/image, 10MB), and optional push-to-calendar that writes an all-day event to your Google or Microsoft calendar. Edits + deletes propagate. A small calendar-check icon shows whether the holiday is in sync.
- **Today dashboard widgets** — tonight's planned dinner (with cook-mode shortcut) and the next holiday's countdown.

Claude calls use `claude-sonnet-4-6` via structured output (Zod-schema-validated). Each call is rate-limited per user (20/day) and logged to `claude_usage` for cost monitoring. Set `ANTHROPIC_API_KEY` in Railway or extraction endpoints return a clear error.

## Runbook

Things that will come up once a year and are annoying to rediscover.

**Backups and restore.** Nightly, by the `backup` cron service, to an S3-compatible bucket; 30 days retained. Restore steps (database and volume) are in [`backup/README.md`](backup/README.md). Do a restore drill twice a year — a backup nobody has restored is a hope, not a backup.

**Health.** `GET /api/health` → `{ ok, checks: { db, uploads } }`, 503 when either is down. Railway's deploy logs show `[env] …` lines at boot if configuration is incomplete.

**Calendar sync stopped.** Settings shows a red "last error" badge per calendar for Google, Microsoft and ICS feeds alike. Typical causes:
- *Azure client secret expired* — they last at most 24 months. Create a new one in the Azure portal, set `MS_CLIENT_SECRET`, redeploy; tokens keep working. Put the expiry date in your calendar when you create it.
- *Consent revoked / password changed* — reconnect the calendar in Settings.
- *Microsoft events beyond a year out never arrive* — the delta window is re-opened automatically every ~9 months (`delta_window_end`); a manual "sync now" in Settings forces it.

**Rotating secrets.** `AUTH_SECRET` (signs sessions; rotating signs everyone out), `WEBHOOK_SECRET` (reconnect calendars afterwards so subscriptions carry the new value), `CRON_SECRET` (update the cron services too), `ENCRYPTION_KEY` (**do not rotate casually** — every stored OAuth token is encrypted with it; rotating means reconnecting every calendar).

**Dependencies.** `next-auth` is a v5 beta; keep it on the newest beta (`pnpm up next-auth@beta`). Run `pnpm outdated` monthly and `pnpm audit --prod` after upgrades. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests and a build on every push.

**Local database.** `DATABASE_URL` unset or `pglite://…` runs Postgres-in-WASM under `.local-db`. It corrupts if the dev server is killed mid-write; the fix is to delete the directory and run `pnpm db:migrate` again (it holds nothing you need). For anything longer-lived use the Docker Postgres from the quick start.

## Not built (yet)

- Real-time collaborative editing on notes (add Yjs if we actually collide)
- Web push notifications (in-app notifications work today)
- Apple iCloud / CalDAV calendar support
