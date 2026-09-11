# Albert Heijn API: research notes (2026-09-11)

Findings for connecting Liefdesnestje to Albert Heijn. Everything here was
verified live on 2026-09-11 unless marked otherwise.

## 1. Is there an official API?

No. Albert Heijn has no public developer program. Everything below is the
private API that the AH mobile app ("Appie") talks to, reverse-engineered by
the community. It is stable enough that several projects have tracked it for
years, but AH changes it without notice (receipts moved from REST to GraphQL in
early 2026, GraphQL introspection was switched off in March 2026).

Terms of use (ah.nl/algemene-voorwaarden, app section): article III.1 forbids
disassembling, decompiling or reverse engineering the app; article II.10 says
the account is for personal use only and you must keep third parties out of
it; article II.40 reserves the right to block accounts. There is no clause on
automated access or third-party clients as such. For a private two-person app
the realistic risk is an account block, not more. Keep request volume low and
do not resell or expose the data.

## 2. How to connect

Base URL: `https://api.ah.nl`. Two surfaces:

- REST under `/mobile-services/...` (products, bonus pages, shopping list PATCH)
- GraphQL at `POST /graphql` (recipes, receipts, favourite lists, basket, member, stores)

Headers that work today (verified):

```
User-Agent: Appie/8.22.3
Content-Type: application/json
x-application: AHWEBSHOP
Authorization: Bearer <access_token>
```

appie-go additionally sends `x-client-name`, `x-client-version` and a newer
User-Agent (`Appie/9.28 (iPhone17,3; ...)`); GraphQL calls in the real app add
`x-apollo-operation-name` and `apollographql-client-name: nl.ah.Appie-apollo-ios`.
Not required today, but cheap insurance if AH starts filtering.

Responses are gzip: send `Accept-Encoding` or use a client that decompresses.

### 2a. Anonymous token (no account, verified)

```
POST https://api.ah.nl/mobile-auth/v1/auth/token/anonymous
{"clientId": "appie"}
→ {"access_token": "...", "refresh_token": "...", "expires_in": 604798}
```

Seven days. Enough for product search, product detail, bonus periods and
promotions, recipe search and recipe detail. Zero user interaction.

### 2b. Member token (needed for shopping list, receipts, orders)

OAuth authorization-code flow, but with a custom-scheme redirect:

1. Open `https://login.ah.nl/login?client_id=appie-ios&response_type=code&redirect_uri=appie://login-exit`
   (older docs use `/secure/oauth/authorize`; both are seen in the wild).
2. The user signs in (email + password, hCaptcha). The server answers
   `303 Location: appie://login-exit?code=CODE`.
3. Exchange: `POST /mobile-auth/v1/auth/token` with `{"clientId":"appie-ios","code":CODE}`
   → access_token, refresh_token, expires_in (no member id).
4. Refresh: `POST /mobile-auth/v1/auth/token/refresh` with
   `{"clientId":"appie-ios","refreshToken":...}` → new pair (rotating, verified).
5. Logout: `POST /mobile-auth/v1/auth/token/logout`.

The catch is step 2: a normal browser cannot follow `appie://`, and the login
page is protected by hCaptcha, so it cannot be scripted with a stored
password. Three ways the community handles it:

- **Local reverse proxy** (appie-go, ah-mcp): a small local HTTP server proxies
  login.ah.nl, rewrites `appie://login-exit` to `http://127.0.0.1:port/callback`
  in headers and HTML, strips CSP/HSTS/cookie flags, opens the browser, the
  human solves the captcha, the code lands on the callback. Works on a laptop.
- **Paste the code**: open the login URL in a desktop browser, log in, copy the
  `code=` value from the failed `appie://` navigation (address bar or devtools),
  paste it into a form. Clunky but zero infrastructure.
- **Stored credentials + Chrome TLS impersonation** (ha-albertheijn): tries a
  scripted login with curl_cffi and falls back to manual tokens when hCaptcha
  blocks it. Not recommended; it is exactly what article II.10 is about.

Recommended for Liefdesnestje: a Settings → "Connect Albert Heijn" flow that
shows the login URL and a "paste code" field, exchanges the code server-side,
stores both tokens encrypted (same pattern as `external_calendar_accounts`
with `encrypt()`/`decrypt()` from `src/lib/auth/encryption.ts`), and refreshes
them on every use. If the refresh ever fails, mark the connection as needing
re-login and show it in Settings, like the calendar sync engines do
(`lastSyncedAt` / `lastError`). Because hCaptcha cannot be automated, the
re-login is always a human step; expect it rarely (refresh tokens rotate and
keep working for weeks in the community projects).

Alternative if the paste flow feels too fiddly: run `appie login` once on the
Mac (appie-go CLI) and paste the two tokens from `~/.config/appie/...` into
Settings.

## 3. What you can do with it

### Anonymous (verified today)

| Capability | Call | Notes |
|---|---|---|
| Product search | `GET /mobile-services/product/search/v2?query=halfvolle%20melk&sortOn=RELEVANCE&size=30&page=0` | Returns `webshopId`, `title`, `currentPrice`, `priceBeforeBonus`, `isBonus`, `bonusMechanism` ("2 VOOR 5.50"), unit price, Nutri-Score, images, taxonomy filters. 30 per page. |
| Products by id | `GET /mobile-services/product/search/v2/products?ids=1,2,3` | Enrichment with bonus text. |
| Product detail | `GET /mobile-services/product/detail/v4/fir/<webshopId>` | Ingredients, allergens, nutrition. |
| Bonus overview | `GET /mobile-services/bonuspage/v3/metadata`, `/bonuspage/v2/section?...`, `/section/spotlight` | Weekly folder. GraphQL `bonusPeriods` returns the current and next bonus week (verified). |
| Recipe search | GraphQL `recipeSearchV2(searchText: "lasagne", size: 20)` → `page { total } result { id title slug time { cook } serving { number } images { url width } nutriScore { ... } }` | `result` items are `RecipeSummary`. Verified: 224 hits for "lasagne". |
| Recipe detail | GraphQL `recipe(id: 1194128) { title servings { number } cookTime ovenTime waitTime ingredients { name { singular plural } quantity quantityUnit { singular } text } preparation { steps summary } images { url width } nutritions { ... } href tags }` | Verified: structured ingredients (quantity, unit, name) and steps as plain strings. `href` gives the ah.nl/allerhande path. |
| Recipe → products | GraphQL `recipeProductSuggestionsV2`, `memberRecipeProductSuggestions` | Maps ingredients to shoppable products (untested). |
| Stores near a postcode | GraphQL `storesSearch(filter: {postalCode})` | Used by appie-go koopjes. |
| Last-chance bargains | GraphQL `bargainItems(storeId)` | Per-store clearance items. |

### With a member token: verified 2026-09-11 with Niki's account

Done with `scripts/ah-login.ts` (tokens in `~/.config/liefdesnestje/ah-tokens.json`).

- Code exchange with `clientId: "appie-ios"` works. Exchanging with `clientId:
  "appie"` is rejected with `Incorrect request send by client`, so use
  `appie-ios` for the login URL and the exchange alike. The first code we tried
  came back `Invalid authorization code` (consumed or expired before exchange);
  the second, exchanged within a minute, worked. The response has only
  `access_token`, `refresh_token`, `expires_in` (7 days); no member id. Prove a
  member token with GraphQL `member { id }`.
- Refresh works and **rotates** the refresh token: always persist the new pair.
- Code recovery in Chrome: the console shows `Failed to launch 'appie://login-exit?code=…'`
  with the full code; copying it from there took under a minute. Two codes were
  needed on the first try because the first one was consumed before exchange.
- `GET /mobile-services/lists/v3/lists?productId=1` → **404**. appie-go's list
  discovery is dead. Mijn lijst is read with
  `GET /mobile-services/shoppinglist/v2/items` → `{ id, items[], dateLastSynced,
  dateLastSyncedMillis, activeSorting, storeNumber }`, items carry
  `listItemId, originCode (PRD|TXT), position, productDetails, quantity, sorting,
  strikedthrough, type`; free-text items also carry `description`.
- `PATCH /mobile-services/shoppinglist/v2/items` with the body below → 200 and
  returns the whole updated list. A free-text item lands with `originCode: "TXT"`.
- **No way to remove or tick an item was found**: `DELETE .../v2/items/<id>` 404,
  `DELETE .../lists/v3/lists/items/<id>` 404, `DELETE .../v2/items` 405, PATCH
  with `quantity: 0` 400, `PUT .../v2/items/<id>` 404. Design the integration as
  add-only; the household removes items in the Appie app. (GraphQL has a newer
  `groceryList(id)` / `groceryListAdd` pair that may grow a delete later.)
- Receipts: `posReceiptsPage` returns real receipts with `id, dateTime, totalAmount`.

### With a member token (from community projects, not verified here)

| Capability | Call |
|---|---|
| Main shopping list ("Mijn lijst") add items | verified above: `PATCH /mobile-services/shoppinglist/v2/items` with `{"items":[{"productId":123,"quantity":1,"type":"SHOPPABLE","originCode":"PRD","description":"...","strikeThrough":false}]}`; free-text items omit `productId`. |
| Read lists | verified above: `GET /mobile-services/shoppinglist/v2/items`. Named lists via GraphQL `favoriteListV2(ids:[...])` need ids that nothing returns any more. |
| Named favourite lists | GraphQL mutations `favoriteListAddV2`, `favoriteListProductsAddV2`, `favoriteListProductsDeleteV2`, `favoriteListDeleteV2` |
| Remove list item | `DELETE /mobile-services/lists/v3/lists/items/<itemId>` |
| Toggle item checked | broken in 2026 (API answers `listItemId=0`), per ah-mcp |
| Online basket / order | GraphQL `basket`, `basketItemsAdd/Update/Delete`, `basketMergeList` (moves list to basket), `orderReopen`, `orderRevert`, `checkoutConfirmOrderV4`; REST `PUT /mobile-services/order/v1/items`, `GET /order/v1/summaries/active` |
| In-store receipts (kassabonnen) | GraphQL `posReceiptsPage(pagination:{offset,limit}) { posReceipts { id dateTime totalAmount { amount } } }` and `posReceiptDetails(id) { products { quantity name price { amount } } discounts { name amount { amount } } payments { method amount { amount } } }` |
| Order history, frequently bought | GraphQL order queries, REST `/order/v1/<id>/details-grouped-by-taxonomy` |
| Member profile, favourite store | GraphQL `member`, `GetFavoriteStore` |
| Personal bonus | `/bonuspage/v2/section/personal`, mutation `activatePersonalPromotion` |

Warning from appie-go: if you reopen a delivered order to add items, always
call `orderRevert` afterwards or the account stays stuck in a phantom order.

## 4. What fits Liefdesnestje

Ranked by value for two people who cook from the weekly meal plan:

1. **Push the generated shopping list into the AH app.** The Meals page
   already aggregates ingredients with Claude and writes them into the
   Groceries to-do list (`src/app/api/meals/shopping-list/route.ts`). Add a
   "Send to Albert Heijn" step: for each aggregated item run a product search,
   let Claude (or a simple heuristic) pick the best match, and PATCH it into
   "Mijn lijst" with the right quantity; unmatched items go in as free text.
   Needs the member token. This is the feature that changes the Saturday
   routine.
2. **Import Allerhande recipes properly.** Today URL import scrapes the page.
   With `recipe(id)` you get clean structured ingredients, steps, servings,
   times, nutrition and images, anonymously. Detect `ah.nl/allerhande/recept/R-R<id>`
   URLs in the existing extract-url route and use GraphQL instead of scraping.
   Zero login, low risk, small change.
3. **Recipe search inside the app.** `recipeSearchV2` behind a search box on
   Meals → Recipes, with "add to recipe book" and optional filters. Anonymous.
4. **Bonus awareness.** Show which ingredients on this week's list are in the
   bonus (product search returns `isBonus` and `bonusMechanism`), or a "this
   week's bonus" lane that suggests recipes via `recipeBonusLane`. Anonymous.
5. **Grocery spend from receipts.** Pull `posReceiptsPage` weekly into the
   Budget page (currently a stub) for an automatic groceries line, itemised.
   Needs the member token and a cron job through an app endpoint (cron
   services do not write to the DB directly; see AGENTS.md).
6. **Online order** from the list (`basketMergeList` + checkout). Powerful but
   the checkout mutations are the least documented and the phantom-order
   trap is real. Leave for later.

## 5. Constraints for the integration prompt

- Route every AH call through one server-side module (`src/lib/albert-heijn/`):
  token store, refresh-on-401, the header set, gzip handling, and a tiny
  per-minute rate limiter. AH sends no rate-limit headers; the community
  reports no blocks at human-scale volumes, but keep searches to one per
  ingredient with caching.
- `safeFetch` is for user-supplied URLs; the AH host is fixed, so a normal
  fetch with `AbortSignal.timeout` is fine, but still cap body size.
- Tokens are secrets: encrypt at rest, never log them, and store per user
  (each member has their own AH account) or per household (one shared
  account) — decide before the schema. A household-level connection is
  simpler and matches how a couple shops.
- Product search results are Dutch; ingredient names from Claude's aggregation
  are whatever language the recipe was in. Matching works best if the
  aggregation step emits a Dutch `searchTerm` per item.
- Expect breakage: keep the AH module isolated, log `lastError`, and surface
  it in Settings the way calendar sync does.
- Delete the connection (tokens) on household deletion and on "Erase" flows.

## 6. Sources

- Community reference gist (auth, endpoints, 2026 comments):
  https://gist.github.com/jabbink/8bfa44bdfc535d696b340c46d228fdd1
- appie-go, Go client + CLI, most complete and most recently maintained
  (commit 2026-05-19): https://github.com/gwillem/appie-go
  API doc: https://github.com/gwillem/appie-go/blob/main/doc/albertheijn_api.md
  GraphQL schema dump (types only, 2026-01-18): https://github.com/gwillem/appie-go/blob/main/doc/graphql-schema-20260118.md
- ah-mcp, MCP server on top of appie-go (2026-03-21): https://github.com/mrserzhan/ah-mcp
- Home Assistant integration (2026-05-25): https://github.com/dpvdberg/ha-albertheijn
- Receipts via GraphQL, FastAPI wrapper (2026-02-14): https://github.com/salujayatharth/ah-api
- GraphQL proof of concept with introspection JSON: https://github.com/JaapWestera/albert-heijn-graphql-api
- Python product scrapers: https://github.com/bartmachielsen/SupermarktConnector
- MCH2022 talk "Reverse engineering the Albert Heijn app": https://media.ccc.de/v/mch2022-248-reverse-engineering-the-albert-heijn-app-for-fun-and-profit
- Terms: https://www.ah.nl/algemene-voorwaarden
- Hosted alternatives if you want a supported vendor instead: https://www.pepesto.com/supermarkets/albert-heijn/ (paid)
