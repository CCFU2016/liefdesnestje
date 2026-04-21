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
5. Add a **Volume** mounted at `/data` for future file uploads (trip documents).
6. Add two **Cron services** pointing at the same repo:
   - `pnpm cron:renew-subscriptions` on `0 */6 * * *` — renews Microsoft/Google webhook subscriptions.
   - `pnpm cron:refresh-ics` on `0 */6 * * *` — refreshes every ICS subscription (4 times/day; deleted events are tombstoned).
7. Update your Azure app's redirect URIs + `NEXT_PUBLIC_APP_URL` to the Railway subdomain.
8. Run the first migration with `railway run pnpm db:migrate` from your local machine.

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
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:push` | Drizzle Kit push (local iteration only) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm test` | Vitest once |
| `pnpm e2e` | Playwright |
| `pnpm cron:renew-subscriptions` | Refresh Graph/Google webhook subscriptions |
| `pnpm cron:refresh-ics` | Re-pull all ICS subscriptions (runs every 6h in prod) |

## v2 features

- **Meals** — shared weekly meal plan (dinner only), recipe book with 4 extraction sources (manual, photo, URL, TikTok/Instagram), cook mode with Wake Lock, and a Claude-powered "Generate shopping list" button that aggregates ingredients across the week and pushes them into the Groceries todo list. Rate-limited to 20 extraction calls per user per day.
- **Holidays** — countdown-styled list of upcoming trips/days-off, per-person tagging, document uploads (PDF/image, 10MB), and optional push-to-calendar that writes an all-day event to your Google or Microsoft calendar. Edits + deletes propagate. A small calendar-check icon shows whether the holiday is in sync.
- **Today dashboard widgets** — tonight's planned dinner (with cook-mode shortcut) and the next holiday's countdown.

Claude calls use `claude-sonnet-4-6` via structured output (Zod-schema-validated). Each call is rate-limited per user (20/day) and logged to `claude_usage` for cost monitoring. Set `ANTHROPIC_API_KEY` in Railway or extraction endpoints return a clear error.

## What's deferred to later sprints

- Trips UI + document uploads (schema and stub page present)
- Budget and Photos pages
- Real-time collaborative editing on notes (add Yjs if we actually collide)
- Web push notifications (in-app notifications work today)
- Apple iCloud / CalDAV support
