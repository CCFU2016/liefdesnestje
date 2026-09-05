<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on Liefdesnestje

A private two-person household app. Small, but it holds data the owners care about, so the rules below are about not losing it and not leaking it.

## Conventions that must hold

- **Every API route and server page calls `requireHouseholdMember()`** (`src/lib/auth/household.ts`) and scopes every query by the returned `householdId`. A route that loads a row by id compares `row.householdId` to the caller's before doing anything else. Visibility is `isVisibleTo` / `visibleToFilter` from `src/lib/auth/visibility.ts` — do not reimplement it.
- **Validate every body with Zod** and put `.max()` on strings and arrays. URLs use `httpUrl` / `httpOrAppUrl` from `src/lib/validation.ts`, never `z.string().url()` (it accepts `javascript:`). Call `rejectIfTooLarge()` (`src/lib/http/body-limit.ts`) before `req.formData()` / `req.json()`.
- **Anything fetched from a user-supplied or third-party URL goes through `safeFetch`** (`src/lib/safe-fetch.ts`) with `AbortSignal.timeout(...)` for the whole request and `readBodyCapped()` for the body.
- **Uploads:** save with `saveUpload()` (`src/lib/uploads.ts`), decide the type with `sniffMime()` (`src/lib/file-magic.ts`), never from the client's Content-Type or extension. Serve routes normalise the path, pin a subfolder, and are auth-gated.
- **Migrations are hand-written SQL** in `drizzle/NNNN_name.sql` + an entry in `drizzle/meta/_journal.json`, idempotent (`IF NOT EXISTS`), applied on every start by `scripts/migrate.ts`. No `drizzle-kit generate` / `push`.
- **Timestamps are `timestamptz`.** Per-row IANA zone columns (e.g. `start_tz`) drive input and display only.
- **Sync engines record their state**: on success `lastSyncedAt = now, lastError = null`; on failure `lastError = message` and rethrow. Settings shows it. Silent failure is a bug.
- **Cron services do not write files.** Only the app service has the uploads volume; anything that must land on disk goes through an app endpoint gated by `requireCronSecret()` (`src/lib/auth/cron.ts`).
- **Secrets** come from env, validated in `src/lib/env.ts`; OAuth tokens at rest go through `src/lib/auth/encryption.ts`. Never log emails, tokens or request bodies.
- **Service worker** (`src/app/sw.ts`) must stay network-only for `/api/*` and page navigations.

## Before you finish

`pnpm check` (typecheck + lint + unit tests), then `pnpm build`. Add a unit test for any pure helper you introduce; `tests/unit/` runs on an in-process PGlite where a database is needed. Commit messages say *why*.
