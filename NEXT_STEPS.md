# Liefdesnestje — what to do next

The app is running at **http://localhost:3000** right now. You can sign in as Niki or Partner (dev-mode buttons) and click through Today / Calendar / To-dos / Notes / Settings. Data persists in `./.local-db` (pglite, a little Postgres that runs in-process).

Below is the full roadmap to get from "dev demo on my laptop" to "real app my girlfriend and I use daily, deployed to Railway."

---

## Part 0 — Poke around the local demo (5 min)

1. Open **http://localhost:3000**. You'll see the sign-in screen.
2. Click **Sign in as Niki**. You land on the Today dashboard.
3. Click around: `To-dos` (try cmd+K to quick-add), `Notes` (make one, format some text, pin it), `Calendar` (you'll see the "connect a calendar" screen — we'll wire that up next), `Settings`.
4. Open a **second browser window in Incognito** → http://localhost:3000 → **Sign in as Partner**. You're now logged in as the other half of the household. Create a todo in one window, watch the other window pick it up within ~5 seconds (SWR polling).
5. To reset the demo data: stop the server (ctrl-C in the terminal), `rm -rf ~/liefdesnestje/.local-db`, then `pnpm db:migrate && pnpm dev` again.

Dev mode is staying on until you turn it off. **Do not deploy to Railway with `ALLOW_DEV_LOGIN=1` in production env** — that would let anyone log in.

---

## Part 1 — Wire up real Google sign-in (15 min)

So your girlfriend can sign in with her real Google account.

1. Go to **https://console.cloud.google.com/**.
2. Top-left dropdown → **New Project** → call it `Liefdesnestje`.
3. Left nav → **APIs & Services** → **OAuth consent screen**.
   - User type: **External**.
   - App name: `Liefdesnestje`. Support email: yours.
   - Add your email as a developer contact.
   - **Scopes**: leave default (email + profile).
   - **Test users**: add your email and your girlfriend's Google email. (While unverified, only test users can sign in — this is fine for just the two of you.)
4. Left nav → **Credentials** → **Create Credentials** → **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Liefdesnestje local`.
   - **Authorized redirect URIs** → add these two:
     - `http://localhost:3000/api/auth/callback/google`
     - *(leave a placeholder line; you'll add your Railway domain here after Part 4)*
   - Click **Create**. A dialog shows your Client ID and Client Secret — keep it open.
5. In your `~/liefdesnestje/.env`, replace the empty lines:
   ```
   AUTH_GOOGLE_ID=<paste the client ID>
   AUTH_GOOGLE_SECRET=<paste the client secret>
   ```
6. Restart the dev server: in the terminal where `pnpm dev` is running, press **ctrl-C**, then `pnpm dev` again.
7. Open http://localhost:3000/signin. You should now see **Sign in with Google** (plus the dev buttons because dev mode is still on).
8. Click it, pick your Google account, accept the consent screen. You should land on the Today dashboard signed in as your real Google account — a new user row in the DB.
9. Your girlfriend can now do step 8 from her laptop (once deployed — see Part 4) — she'll get her own account. Then you invite her to your household from **Settings → Invite your partner**.

---

## Part 2 — Wire up Microsoft calendar sync (25 min)

So the calendar view actually shows your Outlook events.

1. Go to **https://portal.azure.com**. Sign in with the Microsoft account that owns your calendar.
2. Search bar at top → **Microsoft Entra ID** (used to be called Azure AD).
3. Left nav → **App registrations** → **+ New registration**.
   - Name: `Liefdesnestje`.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**. (This is what `MS_TENANT_ID=common` means.)
   - Redirect URI: select **Web** → `http://localhost:3000/api/integrations/microsoft/callback`.
   - Click **Register**.
4. On the app overview page, copy the **Application (client) ID**. Paste into `.env`:
   ```
   MS_CLIENT_ID=<that value>
   ```
5. Left nav of the app → **Certificates & secrets** → **+ New client secret**. Description: `local`, expires: `24 months`. Click **Add**. **Copy the Value immediately** (not the Secret ID — the Value) — it disappears once you leave the page. Paste into `.env`:
   ```
   MS_CLIENT_SECRET=<that value>
   ```
6. Left nav → **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
   - Search for and check: `Calendars.ReadWrite`, `offline_access`, `User.Read`.
   - Click **Add permissions**.
   - Click **Grant admin consent for <directory>** (the button at the top) if available — for personal Microsoft accounts it may not appear, that's fine, the user will consent on first login.
7. Restart the dev server (`ctrl-C`, `pnpm dev`).
8. Open http://localhost:3000, sign in, go to **Settings → Connect Microsoft calendar**. You'll bounce to Microsoft, consent, and come back to settings.
9. Now go to **Calendar**. You should see your Outlook events laid out in the week view.
10. Create an event in the app (click a time slot) → it'll appear in Outlook within a minute.

**For webhook push notifications (real-time calendar updates, not just polling):** Graph needs to call your server from the public internet. For local dev, use a tunnel:

```bash
# Option A: cloudflared (free, no signup)
brew install cloudflared   # or download from https://github.com/cloudflare/cloudflared
cloudflared tunnel --url http://localhost:3000
# prints something like https://abc-def-123.trycloudflare.com
```

Copy that URL into `.env` as `NEXT_PUBLIC_APP_URL`, then **also** add `https://<that>/api/integrations/microsoft/callback` to your Azure app's redirect URIs. Restart the server. Microsoft subscriptions will now POST to `/api/integrations/microsoft/webhook` when events change.

Skip the tunnel if you don't care about sub-30-second event freshness — the app polls `/api/calendar-sync` and SWR every 30 seconds anyway.

---

## Part 3 — Deploy to Railway (20 min)

So you can actually use it from your phones without leaving `pnpm dev` running on your laptop.

1. Put the project on GitHub:
   ```bash
   cd ~/liefdesnestje
   gh repo create liefdesnestje --private --source=. --push
   ```
   (If you don't have `gh`, do it via the github.com UI: new repo → private → then `git remote add origin <url>` and `git push -u origin main`.)

2. Go to **https://railway.app** → sign in with GitHub → **+ New Project** → **Deploy from GitHub repo** → pick `liefdesnestje`. Railway detects Next.js and starts building.

3. In the project, click **+ New → Database → Add PostgreSQL**. This injects `DATABASE_URL` into the app service automatically — no action needed.

4. On the app service → **Variables** tab → add (one per line, copy from your local `.env`):
   - `AUTH_SECRET` ← generate a new one with `openssl rand -base64 32`; do **not** reuse the dev one.
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` ← same Google OAuth client or a new one.
   - `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT_ID=common`.
   - `ENCRYPTION_KEY` ← generate a new one with `openssl rand -hex 32`; do **not** reuse dev.
   - `WEBHOOK_SECRET` ← `openssl rand -hex 32`.
   - `NEXT_PUBLIC_APP_URL=https://<the Railway-generated URL>` (you get it from the Settings tab → Generate Domain).
   - **Do not set `ALLOW_DEV_LOGIN`.** Leave it off in prod.

5. On the app service → **Settings → Generate Domain**. You get `something-production-abcd.up.railway.app`. Copy that URL.

6. Add that URL's callback paths to your OAuth apps:
   - **Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs**: add `https://<railway-domain>/api/auth/callback/google`.
   - **Azure portal → your app → Authentication → Redirect URIs**: add `https://<railway-domain>/api/integrations/microsoft/callback`.

7. Run the initial migration against the Railway DB. Easiest way: install Railway CLI (`brew install railway` or `npm i -g @railway/cli`), then:
   ```bash
   cd ~/liefdesnestje
   railway login
   railway link        # pick your project
   railway run pnpm db:migrate
   ```

8. Open the Railway URL. **Sign in with Google**. You're the household owner.

9. Go to **Settings → Invite your partner**. Copy the link. Send it to your girlfriend. She opens it, signs in with her Google, picks a color → she's in.

10. Both of you go to **Settings → Connect Microsoft calendar** (if you want her Outlook too).

11. **Subscription renewal cron** (so Graph keeps pushing events): on the Railway project → **+ New → Empty service** → **Settings → Cron** → expression `0 */6 * * *`, command `pnpm cron:renew-subscriptions`, image: same repo. This keeps webhook subscriptions alive (they expire every ~70 hours).

---

## Part 4 — Day-to-day after it's live

**You (the developer):**
- Dev locally against pglite (`pnpm dev`) — no Postgres install needed.
- When you change the schema: `pnpm db:generate` to make a migration, commit it, push. Then `railway run pnpm db:migrate` to apply in prod.
- `pnpm test` and `pnpm typecheck` before pushing.
- PRs deploy to Railway automatically on push to main.

**Your girlfriend:**
- Just the deployed URL. Nothing to install. She signs in with Google, see items, adds things. If anything looks broken she can tell you and you'll find the error in Railway's log tab.

---

## Things the brief deferred — ask me to build when you want them

- **Google Calendar sync** (she might want this alongside Microsoft).
- **Trips** page: itinerary items, flight/hotel, document uploads, countdowns.
- **Photos** and **Budget** pages.
- **Mobile-friendly calendar view** — `react-big-calendar` on phone is serviceable in Day view but not great. A custom mobile agenda view would be nicer.
- **Web push notifications** — today the app sends in-app notifications (bell icon in the header). Adding web-push means she gets a ping on her phone without the app open.
- **Real-time collaborative editing on notes** — if you both frequently edit the same note at the same time and hit last-write-wins conflicts.

---

## When things go wrong

- **"Something went wrong" toast in the UI** → check the terminal running `pnpm dev`. Errors show up there, not in the UI.
- **Sign-in redirect loop** → clear cookies for localhost, restart the dev server. Usually means the session cookie points at a row that's been wiped.
- **Calendar events don't sync** → **Settings → Connect Microsoft calendar** again; the initial sync runs on reconnect. Check the terminal log for any Graph errors. Token expiry is auto-handled.
- **Reset everything locally:** `ctrl-C`, `rm -rf ~/liefdesnestje/.local-db`, `pnpm db:migrate`, `pnpm dev`.
- **In prod, reset Postgres** (nuclear option): Railway → Postgres service → Settings → Restart → accept data loss warning. Then `railway run pnpm db:migrate`.

---

Running now: **http://localhost:3000** — `pnpm dev` is live in your terminal.
