# Liefdesnestje — recent features & updates

The last 20 things shipped, newest first. Each entry is a user-facing change; routine chores and reverts are merged into the feature they fixed.

---

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

---

*Dates aren't pinned here because the Git log has them, but all 20 shipped to production between V2 launch and now.*
