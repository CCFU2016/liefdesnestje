import "dotenv/config";

// Albert Heijn weekly: import new receipts and activate the Bonus Box offers
// for the products each nest buys most. The work happens inside the app
// (POST /api/internal/ah-weekly) so the AH tokens stay there.
//
// AH publishes a new bonus week on Monday and the personal offers with it,
// so run it Monday morning and once more mid-week for late arrivals:
// Railway Cron `30 6 * * 1,4` (UTC). Required env on the cron service:
// APP_URL and CRON_SECRET (same value as the app).

async function main() {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl) throw new Error("APP_URL is not set");
  if (!secret) throw new Error("CRON_SECRET is not set");

  const res = await fetch(new URL("/api/internal/ah-weekly", appUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    households?: number;
    failed?: number;
    results?: Array<{ householdId: string; ok: boolean; ms: number; summary?: string; error?: string }>;
    error?: string;
  };
  if (!res.ok && res.status !== 207) {
    throw new Error(`app returned ${res.status}: ${body.error ?? "unknown error"}`);
  }
  for (const r of body.results ?? []) {
    console.log(`[ah-weekly] household ${r.householdId}: ${r.ok ? r.summary : `FAILED ${r.error}`} (${r.ms}ms)`);
  }
  console.log(`[ah-weekly] ${body.households ?? 0} household(s), ${body.failed ?? 0} failed`);
  process.exit(body.failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[ah-weekly] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
