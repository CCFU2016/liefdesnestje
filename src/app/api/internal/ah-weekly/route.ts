import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth/cron";
import { connectedHouseholdIds } from "@/lib/ah/receipt-sync";
import { runWeekly } from "@/lib/ah/weekly";

// Bonus Box + receipt import for every connected household. Called by the
// ah-weekly cron (scripts/ah-weekly.ts). Runs inside the app so the AH
// tokens never leave it.
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const results: Array<{ householdId: string; ok: boolean; ms: number; summary?: string; error?: string }> = [];
  for (const householdId of await connectedHouseholdIds()) {
    const started = Date.now();
    try {
      const r = await runWeekly(householdId);
      const acts = r.periods.flatMap((p) => p.activated);
      results.push({
        householdId,
        ok: true,
        ms: Date.now() - started,
        summary: `${r.receipts.imported} receipts imported; ${acts.length} offer(s) activated: ${acts.map((a) => `${a.title} [${a.status}]`).join(", ") || "none"}`,
      });
    } catch (e) {
      results.push({ householdId, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`[ah-weekly] ${results.length} household(s), ${failed} failed`);
  return NextResponse.json({ households: results.length, failed, results }, { status: failed ? 207 : 200 });
}
