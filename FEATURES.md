# Liefdesnestje — recent features & updates

The last 20 things shipped, newest first. Each entry is a user-facing change; routine chores and reverts are merged into the feature they fixed.

---

## 0f. Calendar chrome refresh (from the Claude Design project)

The calendar got the designed chrome: zinc neutrals with a warm sage accent (`--cal-accent`). Desktop toolbar is a joined **‹ Today ›** group + month title, a segmented view switcher (active = white chip), **Sync now**, and a sage **New** button. Month/week/day/agenda render as bordered cards; today is a sage circle on the date; events are neutral pills with a 3px calendar-color bar (month/agenda) or color-tinted blocks (time views). The legend became tap-to-filter chips (filled dot = visible, outlined = hidden). The event dialog has the "Invited by …" subtitle, a proper sage **Private** toggle row, and a footer band with Delete left / Cancel + Save right. Mobile 3-day view matches: range title, square nav buttons, sage today circle, tinted event blocks. Light + dark throughout.

## 0e. Travel map

New **Travel map** section (last in the menu, 📍 icon): a world map (Carto light tiles via Leaflet, with a bundled country-boundary overlay) where you pin every place you've been. **Colors are fixed**: Niki light blue, Laura pink, together orange — pins, country fills, chips, and the legend all agree, and the US fills **state by state** (its own boundary layer from the US Census atlas). Adding uses **city-level autocomplete** (Photon/komoot, server-side proxy) — pick several cities in one go and they become a **trip** with a name, shared date, who-was-there, and notes. Dates are flexible: month+year is the default, exact date, year-only, or no date at all. The **Countries visited** card shows a per-person country counter, splits countries into Together / Niki / Laura sections, and each chip expands into its per-trip visit history (the US also shows its state chips); trips are editable in place — rename, add/remove stops, change shared details, or delete. Repeat visits to the same city fan out into clickable pins. New tables: `visited_places` + `trips`. (Also: Fiji/Russia antimeridian polygons unwrapped and Antarctica dropped from the boundary layer — they drew stray horizontal lines across the map.)

## 0c. Bucket list

New **Bucket list** section, last in the menu. Create categories (travel, movies to watch, …), add dreams with notes and any number of links, and both of you rate each item 1–5 stars — your stars are amber and clickable, your partner's show in their member color. Items sort by combined star count (most-wanted first), can be ticked off (🎉) and put back, and deleting a category keeps its items as "uncategorized" so nothing is ever lost. Three new tables (`bucket_list_categories`, `bucket_list_items`, `bucket_list_stars`); ratings upsert per (item, member).

## 0d. See who sent a calendar invite

Clicking a synced calendar event now shows **"Invited by ⟨name⟩ (email)"** under the dialog title. The organizer is captured from Microsoft Graph, Google Calendar, and ICS feeds (`ORGANIZER` property) into two new columns on `events`; the migration clears every calendar's delta/sync tokens so the next sync backfills organizers on existing events.

## 0a. Edit an event from its own page

The event detail page now has a proper **Edit** button (next to the countdown) instead of the old "Edit from the list" link. It opens the same dialog the events list uses — title, dates, people, category, calendar push, private toggle, document — and saves in place. Deleting from the dialog returns you to the events list. Only the event's author sees the button, matching the list behavior.

## 0b. Dismiss chores nobody did

Uncompleted chores (today's and carried-over ones) have a small **✕ dismiss** button: "nobody did this one, stop nagging." A dismissed occurrence awards 0 points, stays off the leaderboard (points *and* completion count), and shows as a grey "Skipped by Niki" row that can be undone like a normal completion. Backed by a new `skipped` column on chore completions; the same unique (chore, date) row means a dismiss and a real completion can't double-book a day.

## 1. Attach multiple documents to any event

Every event page now has a **Documents** card. Any event author can attach PDFs or images (JPEG / PNG / GIF / WebP, up to 10MB each) via an Attach button. Files are magic-byte sniffed, saved to the Volume under `holidays/<eventId>/docs/`, and served through an auth-gated endpoint. Each attachment has a trash button for quick removal. The old single-document field still renders as a read-only row at the top of the list so nothing disappears retroactively.

## 2. Today page — no more horizontal-scroll surprise; first-name-only chips

A long reservation subtitle (e.g. "Schiphol Airport, Amsterdam → John F. Kennedy International Airport") was pushing the travel tile wider than the mobile viewport. The Today grid now explicitly uses `grid-cols-1 md:grid-cols-2` with `min-w-0` and `overflow-hidden` on the cards so children clip instead of bleed. A one-shot migration also trims every `household_members.display_name` to its first word so name chips say `Niki` and `Laura`, not full names.

## 3. Lock mobile pinch-zoom

The installed PWA no longer lets accidental pinches reflow the UI. The `viewport` export sets `maximumScale: 1` + `userScalable: false`. In a regular Safari browser tab iOS still allows zoom for accessibility — only the standalone Add-to-Home-Screen app is locked.

## 4. Swipe between days on the Today page

Touch users can now swipe left → next day, right → previous day on the Today page. Gated so the gesture doesn't interfere with vertical scrolling, taps, or text selection (must travel >60px horizontally in <700ms and be ≥1.5× more horizontal than vertical). Swipes that start inside inputs, textareas, or the rich-text editor are ignored.

## 5. Events card — merged Ongoing + Upcoming, dynamic height

The Today page used to show two separate cards ("Ongoing events" and "Next event"). They're now a single **Events** card listing ongoing rows first (with a green `Day X of Y` badge) followed by upcoming rows (with `in N days`). The card stretches to match its neighbor's height on desktop and scrolls internally if the list overflows; to-dos card is hidden entirely when the list is empty.

## 6. Microsoft Calendar timezones fixed

Laura's events were shifted by 2 hours because Microsoft Graph was returning naive datetimes in her Outlook-configured timezone, and our sync was tagging them as UTC. Added `Prefer: outlook.timezone="UTC"` to the Graph request so times arrive in UTC, and a migration that nulls delta links on all Microsoft calendars to force a clean re-sync. Simultaneously, Today page event times now render through a `<LocalTime>` client component (instead of server-side `format()` on Railway's UTC clock), and the greeting uses `Intl.DateTimeFormat` with `Europe/Amsterdam` so "Good morning/afternoon" is right regardless of server TZ.

## 7. Photo of the day on Today

Paste an iCloud **Shared Album** URL in Settings → Photo of the day and the app picks a random photo from it each day, downloaded to the Volume, and shown on the Today page with caption, taken-at date, and contributor. EXIF GPS is extracted via `exifr` when not stripped by Apple; a Nominatim reverse-geocode turns it into a readable place name (e.g. `📍 Amsterdam, Netherlands` with a click-through to Google Maps). Photos are excluded from the next 30 days' pool so a new image shows up every time. Graceful fallbacks (last-good photo when today's pick fails; multi-seed partition discovery for the iCloud endpoint) keep the card visible across transient hiccups.

## 8. Link a second Google account to one profile

You can now sign in to the same app user from two different Google accounts. Settings → Sign-in methods lists your linked accounts; an **Add another** button runs a proper OAuth round-trip (with session-bound state verification) and inserts an `accounts` row against your existing user. When the target Google account already belongs to another profile, a red **"Replace the other profile"** button (with confirm dialog) offers a force path that deletes the other user and everything cascaded to them.

## 9. Sign-out works, home page shows ongoing events

The sign-out form silently did nothing because Auth.js v5 needs CSRF on `/api/auth/signout`. Replaced with a server action that calls Auth.js's `signOut()` directly. At the same time, the Today page now separately queries ongoing events (not just upcoming ones) so a holiday in progress shows up.

## 10. Travel module — reservations on any event

Events can now include **travel**. Tick the "Involves travel" box on an event and attach hotel / flight / train / car-rental / ferry / transit reservations. Each reservation has a title, start/end datetime, origin/destination (flights/trains) or location (hotels), confirmation code, booking URL, notes, and who's travelling (colored chips). You can fill manually or **upload a PDF or screenshot and hit Analyze** — Claude Sonnet extracts all the structured fields for a review-and-confirm step before saving. Saved reservations render on the Today page in a **Travel today** card with hotel check-in/check-out labels, flight origin → destination, Maps button, and a jump to the owning event.

## 11. Restaurant dinners — paste URL, extract menu, open in Maps

Planning dinner now has a third tab ("Restaurant") alongside recipe and free text. Paste a restaurant URL, click Extract, and Claude Sonnet pulls the name, address, and a direct menu link from the site. Reservation time is a `datetime-local` input pre-seeded to 19:00 on the picked day. The Today page's **Tonight's Dinner** card renders restaurant entries with an orange utensil tile, reservation time, and **Menu** + **Open in Maps** buttons.

## 12. Work status chip on the home page

When the `Niki werk` calendar has an all-day `Office NL` or `Telework` event today, the Today page shows a small indigo pill under the greeting: `Niki op kantoor` or `Niki thuiswerken`. The query picks the freshest matching row deterministically so overlapping Office NL + Telework entries don't flip between refreshes.

## 13. Day navigation on the Today page

`/today?date=YYYY-MM-DD` renders the same dashboard for any date. Prev / Today / Next buttons, ArrowLeft/ArrowRight keyboard shortcuts, and card labels that adjust ("Tonight's dinner" → "Dinner · 25 Apr"). The Sunday dinner popup only fires when viewing today so it doesn't ambush you scrolling through the past.

## 14. Sign-out button in the top header

Mobile users don't see the desktop sidebar and had no way to sign out without hitting `/api/auth/signout` by hand. Added a LogOut icon button to the header so it's reachable on every screen size.

## 15. Dinner attendance — weekly Sunday prompt

Each day now carries an optional "eating out" flag per household member. Per-day chips under every day card in the weekly meals grid let you toggle who's home; the Today page's dinner card shows amber "Laura eating out" pills on days someone's away. Every Saturday and Sunday a modal pops up on the Today page asking "Who's eating at home next week?" and writes all 14 cells (2 members × 7 days) to the `dinner_absences` table in one bulk PUT. Dismissal is tracked in localStorage keyed by the target ISO week.

## 16. Installable PWA

Liefdesnestje is now an installable PWA. On Chrome (Android/desktop) you get the install prompt; on iOS Add-to-Home-Screen gives a standalone app experience. Includes a `@serwist/next` service worker with precached assets and runtime caching, a proper `manifest.webmanifest` with 192/512 icons + a maskable variant for Android adaptive masking, `appleWebApp` metadata, and light/dark `themeColor`.

## 17. Magic-byte MIME validation on uploads

Recipe hero image, recipe extract-image, and event document uploads no longer trust the client-supplied `Content-Type`. A small inline sniffer checks the first bytes for JPEG / PNG / GIF / WebP / PDF signatures and rejects anything else, so you can't spoof an HTML payload as an image.

## 18. Security headers + auth-gated recipe images + dev-login harden + timing-safe webhooks

Baseline security hardening: HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, and a basic CSP on every response. `/api/uploads/recipes/*` now requires a signed-in user (backed by a 60s in-memory session cache so a 20-image grid doesn't DB-hammer). The dev-login endpoint rejects non-local hostnames as defense-in-depth. Microsoft `clientState` and Google `X-Goog-Channel-Token` webhook comparisons use `crypto.timingSafeEqual` instead of plain `!==`.

## 19. SSRF defense — safeFetch wrapper

New `safeFetch` helper blocks private/loopback/link-local IPs (v4 and v6, including IPv4-mapped IPv6), rejects non-http(s) schemes, and re-verifies the host on every redirect hop. Plumbed into the recipe URL scraper, the TikTok/Instagram scraper, the ICS feed fetch, and the image downloader — so a malicious paste can't pivot to internal services.

## 20. Mobile calendar — past all-day events no longer bleed

The custom mobile 3-day grid was clamping out-of-range all-day events to the view edges, so events from previous weeks leaked into today's row. Added an explicit skip-if-outside-view check and day-diff column calculation so only events that overlap the viewed range show up.

## 21. Albert Heijn connection

Settings gets an **Albert Heijn** card: one connection per nest, on one member's AH account, tokens AES-GCM encrypted in `ah_connections`. Connecting is a paste-the-code step (AH only redirects to `appie://`, and its login has a captcha, so nothing can do it unattended); the card walks through it and only the person who connected it sees the renew/disconnect controls — the other member sees the status and "ask … to renew". Refreshes are serialised per household with an advisory lock because the refresh token rotates. Under the hood `src/lib/ah/` wraps the AH app's private API — product search, products by id, Mijn lijst read/append, receipts — with every response Zod-parsed at the boundary; nothing outside that folder knows a URL or header.

## 22. Allerhande recipes

"Add a recipe" gets a fifth source: **Allerhande**. Search Albert Heijn's recipe site from inside the app and pick one; it lands in the normal recipe form with structured ingredients (quantity, unit, name), steps, servings, cook time, Nutri-Score-grade nutrition and the hero image copied to our uploads. Pasting an `ah.nl/allerhande/recept/…` link into "From a website" takes the same path. Both go through AH's GraphQL with an anonymous token — no login, no Claude call, so they don't touch the daily extraction budget — and fall back to the old scraper if AH is down.

## 23. Send to Albert Heijn

The feature the connection exists for: plan meals here, shop with the Appie app (aisle order, bonus). The Groceries to-do list gets a **Send N new to Albert Heijn** button, and the meal plan's "Generate shopping list" offers the same right after pushing. One batched Claude call turns each item into a Dutch search term and a pack count (a household that chose "AH Kipfilet" for "chicken breast" before skips Claude next time: `ah_product_matches`), AH product search supplies up to three candidates per item, and a review sheet shows thumbnail, size, price and bonus with swap, "just add as text" and a pack stepper, plus a footer estimate. Confirm sends everything to Mijn lijst in one call; sent to-dos get `ah_sent_at` so nothing goes twice, and the sheet offers to tick them off here too. AH down, not connected or needing renewal each get their own plain-language message; the Groceries list itself is never touched by a failure.

## 24. Bonus tags

Once an ingredient has been sent to Albert Heijn as a product, the app knows which AH product it is — so a recipe's ingredient list and the week's meal cards show a small orange **Bonus · 2e halve prijs** tag whenever that product is in bonus this week. One anonymous products-by-id call per distinct set of ingredients, cached six hours on the server and an hour in the browser; nothing is looked up for ingredients that were never matched, and if AH is unreachable the tags simply don't appear.

## 25. Bonus Box on autopilot, and "in the bonus this week"

In-store receipts are imported into our own tables (till product ids bridged to webshop ids through AH's `productConvertId`), which makes purchase frequency something the app can query. Two things use it. A weekly job (Mon/Thu cron, or **Check now** in Settings) reads the personal Bonus Box for the current and next bonus week and activates the offers whose products the nest bought at least twice in the past year, best first, within AH's ten-activation limit; offers already switched on in the app are left alone, and Settings lists what was activated with the status AH confirmed. And the Today page gets an **In the bonus this week** card under tonight's dinner: AH's "bonus for products you bought before", ordered by how often we actually buy each one, collapsed to a button until tapped, cached six hours and never allowed to slow the page.

---

*Dates aren't pinned here because the Git log has them, but all 20 shipped to production between V2 launch and now.*
