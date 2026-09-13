import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";
import { getAhConnectionStatus } from "@/lib/ah/connection";
import { prepareSend } from "@/lib/ah/send";

export const maxDuration = 60;

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        todoId: z.string().uuid().nullable().optional(),
        title: z.string().trim().min(1).max(500),
      })
    )
    .min(1)
    .max(100),
});

// Step 1 of "Send to Albert Heijn": product candidates for review. Fails
// early when the nest has no working AH connection, before any searching.
export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const status = await getAhConnectionStatus(ctx.householdId);
    if (!status.connected) return NextResponse.json({ error: "Albert Heijn isn't connected yet.", code: "not-connected" }, { status: 409 });
    if (status.needsReconnect) return NextResponse.json({ error: "The Albert Heijn connection needs renewing.", code: "reconnect" }, { status: 409 });

    const result = await prepareSend({ householdId: ctx.householdId, userId: ctx.userId, items: parsed.data.items });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("ah prepare failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't reach Albert Heijn right now — your list here is unchanged." }, { status: 502 });
  }
}
