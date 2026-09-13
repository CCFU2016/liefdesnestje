import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";
import { AhApiError } from "@/lib/ah/client";
import { AhNotConnectedError, AhReconnectError, getAhConnectionStatus } from "@/lib/ah/connection";
import { receiptCount } from "@/lib/ah/receipt-sync";
import { recentActivations, runWeekly } from "@/lib/ah/weekly";

export const maxDuration = 300;

// What the Bonus Box job did lately, for the Settings card.
export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const [status, activations, receipts] = await Promise.all([
      getAhConnectionStatus(ctx.householdId),
      recentActivations(ctx.householdId),
      receiptCount(ctx.householdId),
    ]);
    return NextResponse.json({
      connected: status.connected && !status.needsReconnect,
      receipts,
      activations: activations.map((a) => ({
        title: a.title,
        periodStart: a.periodStart,
        periodEnd: a.periodEnd,
        score: a.score,
        status: a.status,
        at: a.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("ah weekly status failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

const bodySchema = z.object({ dryRun: z.boolean().default(false) });

// "Check the Bonus Box now": the same job the cron runs, for this nest.
export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const status = await getAhConnectionStatus(ctx.householdId);
    if (status.connected && status.connectedByUserId && status.connectedByUserId !== ctx.userId) {
      return NextResponse.json({ error: "Only the person who connected Albert Heijn can run this." }, { status: 403 });
    }
    const result = await runWeekly(ctx.householdId, { dryRun: parsed.data.dryRun });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof AhNotConnectedError) return NextResponse.json({ error: "Albert Heijn isn't connected yet.", code: "not-connected" }, { status: 409 });
    if (e instanceof AhReconnectError) return NextResponse.json({ error: "The Albert Heijn connection needs renewing.", code: "reconnect" }, { status: 409 });
    if (e instanceof AhApiError) return NextResponse.json({ error: "Couldn't reach Albert Heijn right now. Try again in a minute." }, { status: 502 });
    console.error("ah weekly failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
