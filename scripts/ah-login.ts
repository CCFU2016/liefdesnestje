/*
 * Sprint 0 helper: prove the Albert Heijn member login flow.
 *
 *   pnpm tsx scripts/ah-login.ts                 → prints the login URL + steps
 *   pnpm tsx scripts/ah-login.ts <code|appie-url> → exchanges the code, saves tokens,
 *                                                  checks the member-only calls
 *   pnpm tsx scripts/ah-login.ts --check         → re-runs the checks with saved tokens
 *                                                  (refreshing them first)
 *   pnpm tsx scripts/ah-login.ts --add-test-item → adds one free-text item
 *                                                  "Liefdesnestje test" to Mijn lijst
 *
 * Prints counts and field names only: never tokens, never product names.
 * Tokens are stored in ~/.config/liefdesnestje/ah-tokens.json (mode 0600).
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://api.ah.nl";
const CLIENT_ID = "appie-ios";
const LOGIN_URL = `https://login.ah.nl/login?client_id=${CLIENT_ID}&response_type=code&redirect_uri=appie://login-exit`;
const HEADERS: Record<string, string> = {
  "User-Agent": "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)",
  "x-client-name": CLIENT_ID,
  "x-client-version": "9.28",
  "x-application": "AHWEBSHOP",
  Accept: "application/json",
  "Content-Type": "application/json",
};
const TOKEN_DIR = join(homedir(), ".config", "liefdesnestje");
const TOKEN_FILE = join(TOKEN_DIR, "ah-tokens.json");

type Tokens = { access_token: string; refresh_token: string; expires_at: string; member_id?: unknown };

function extractCode(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/[?&]code=([^&\s]+)/);
  return decodeURIComponent(m ? m[1] : trimmed);
}

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { ...HEADERS };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(BASE + path, { ...init, headers, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, size: text.length };
}

function keys(v: unknown): string[] {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object) : [];
}

function saveTokens(raw: Record<string, unknown>) {
  const expiresIn = Number(raw.expires_in ?? 0);
  const t: Tokens = {
    access_token: String(raw.access_token),
    refresh_token: String(raw.refresh_token),
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    member_id: raw.member_id ?? raw.memberId,
  };
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
  chmodSync(TOKEN_FILE, 0o600);
  return t;
}

function loadTokens(): Tokens {
  if (!existsSync(TOKEN_FILE)) throw new Error(`No saved tokens at ${TOKEN_FILE}; log in first.`);
  return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Tokens;
}

async function exchange(code: string) {
  const r = await call("/mobile-auth/v1/auth/token", {
    method: "POST",
    body: JSON.stringify({ clientId: CLIENT_ID, code }),
  });
  console.log(`exchange: HTTP ${r.status}, fields: ${keys(r.json).join(", ") || "(none)"}`);
  if (r.status !== 200 || !keys(r.json).includes("access_token")) {
    console.log("  body preview:", JSON.stringify(r.json)?.slice(0, 200));
    throw new Error("Code exchange failed (codes are single-use and expire within minutes).");
  }
  const t = saveTokens(r.json as Record<string, unknown>);
  console.log(`  saved to ${TOKEN_FILE}; expires ${t.expires_at}; member_id present: ${t.member_id != null}`);
  return t;
}

async function refresh(t: Tokens) {
  const r = await call("/mobile-auth/v1/auth/token/refresh", {
    method: "POST",
    body: JSON.stringify({ clientId: CLIENT_ID, refreshToken: t.refresh_token }),
  });
  console.log(`refresh: HTTP ${r.status}, fields: ${keys(r.json).join(", ") || "(none)"}`);
  if (r.status !== 200 || !keys(r.json).includes("access_token")) throw new Error("Refresh failed");
  const rotated = (r.json as Record<string, string>).refresh_token !== t.refresh_token;
  console.log(`  refresh token rotated: ${rotated}`);
  return saveTokens(r.json as Record<string, unknown>);
}

async function gql(token: string, query: string, variables: Record<string, unknown> = {}) {
  return call("/graphql", { method: "POST", token, body: JSON.stringify({ query, variables }) });
}

async function checks(t: Tokens) {
  const tok = t.access_token;

  // (a) proof that this is a member token, not an anonymous one
  const member = await gql(tok, "query { member { id isB2B } }");
  const m = (member.json as { data?: { member?: { id?: number } }; errors?: unknown[] })?.data?.member;
  console.log(`member: HTTP ${member.status}, member.id present: ${m?.id != null}${(member.json as { errors?: unknown[] })?.errors ? ", errors: " + JSON.stringify((member.json as { errors: unknown[] }).errors).slice(0, 200) : ""}`);

  // (b) Mijn lijst: GET /shoppinglist/v2/items (verified 2026-09-11; the older
  //     /lists/v3/lists endpoint from appie-go returns 404 now)
  const list = await call("/mobile-services/shoppinglist/v2/items", { token: tok });
  const lj = list.json as { items?: Record<string, unknown>[] } | null;
  const items = lj?.items ?? [];
  const txt = items.filter((i) => i.originCode === "TXT").length;
  console.log(`Mijn lijst: HTTP ${list.status}, items: ${items.length} (${txt} free text), list fields: ${keys(lj).join(", ")}, item fields: ${keys(items[0]).join(", ") || "(none)"}`);

  // (c) receipts page
  const rec = await gql(
    tok,
    "query FetchPosReceipts($offset: Int!, $limit: Int!) { posReceiptsPage(pagination: {offset: $offset, limit: $limit}) { posReceipts { id dateTime totalAmount { amount } } } }",
    { offset: 0, limit: 5 }
  );
  const receipts = (rec.json as { data?: { posReceiptsPage?: { posReceipts?: unknown[] } } })?.data?.posReceiptsPage?.posReceipts;
  console.log(`receipts: HTTP ${rec.status}, count (max 5): ${receipts?.length ?? "n/a"}, fields: ${keys(receipts?.[0]).join(", ") || "(none)"}`);
}

async function addTestItem(t: Tokens) {
  const r = await call("/mobile-services/shoppinglist/v2/items", {
    method: "PATCH",
    token: t.access_token,
    body: JSON.stringify({
      items: [{ description: "Liefdesnestje test", quantity: 1, type: "SHOPPABLE", originCode: "PRD", strikeThrough: false }],
    }),
  });
  console.log(`add test item: HTTP ${r.status}, response fields: ${keys(r.json).join(", ") || "(none)"}, ${r.size} bytes`);
  console.log("  → open the Appie app, check Mijn lijst, and delete the test item there.");
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log("1. Open this URL in Chrome or Safari on the Mac (not on the phone, the AH app would grab the redirect):");
    console.log("   " + LOGIN_URL);
    console.log("2. Sign in. The browser then fails to open appie://login-exit?code=…");
    console.log("   Copy that whole URL from the address bar (or, in DevTools › Network, the Location header of the 303).");
    console.log("3. Within a couple of minutes, run:");
    console.log("   pnpm tsx scripts/ah-login.ts 'appie://login-exit?code=…'");
    return;
  }
  if (arg === "--check") {
    const t = await refresh(loadTokens());
    await checks(t);
    return;
  }
  if (arg === "--add-test-item") {
    const t = await refresh(loadTokens());
    await addTestItem(t);
    return;
  }
  const t = await exchange(extractCode(arg));
  await checks(t);
}

main().catch((e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
