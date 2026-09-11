import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";
import { extractAuthCode } from "@/lib/ah/auth";
import { AhApiError } from "@/lib/ah/client";
import { connectHousehold, getAhConnectionStatus } from "@/lib/ah/connection";

export const maxDuration = 30;

const bodySchema = z.object({
  // The pasted code, the appie:// URL, or the Chrome console line around it.
  code: z.string().min(8).max(2048),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Paste the code or the whole appie:// link." }, { status: 400 });

    const code = extractAuthCode(parsed.data.code);
    if (!code) {
      return NextResponse.json({ error: "That doesn't look like a login code. Paste the whole appie://login-exit?code=… link." }, { status: 400 });
    }

    const status = await getAhConnectionStatus(ctx.householdId);
    if (status.connected && status.connectedByUserId && status.connectedByUserId !== ctx.userId) {
      return NextResponse.json({ error: "Albert Heijn is connected by someone else in your nest. Ask them to renew it." }, { status: 403 });
    }

    await connectHousehold({ householdId: ctx.householdId, userId: ctx.userId, code });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof AhApiError) {
      // 400 "Invalid authorization code": used up or too old. Never log the body.
      const msg =
        e.status === 400
          ? "Albert Heijn didn't accept that code. Codes work once and only for a few minutes — log in again and paste the new one straight away."
          : "Couldn't reach Albert Heijn right now. Try again in a minute.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    console.error("ah connect failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
