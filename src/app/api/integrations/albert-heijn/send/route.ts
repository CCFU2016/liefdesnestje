import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";
import { AhApiError } from "@/lib/ah/client";
import { AhNotConnectedError, AhReconnectError } from "@/lib/ah/connection";
import { sendToAh } from "@/lib/ah/send";

export const maxDuration = 30;

const bodySchema = z.object({
  selections: z
    .array(
      z.object({
        todoId: z.string().uuid().nullable().optional(),
        key: z.string().min(1).max(120),
        title: z.string().trim().min(1).max(500),
        packs: z.number().int().min(1).max(99),
        productId: z.number().int().positive().nullable(),
        productTitle: z.string().max(500).nullable().optional(),
        imageUrl: z.string().url().max(2048).nullable().optional(),
      })
    )
    .min(1)
    .max(100),
});

// Step 2: the reviewed selections go to Mijn lijst in one call.
export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const result = await sendToAh({ householdId: ctx.householdId, userId: ctx.userId, selections: parsed.data.selections });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof AhNotConnectedError) {
      return NextResponse.json({ error: "Albert Heijn isn't connected yet.", code: "not-connected" }, { status: 409 });
    }
    if (e instanceof AhReconnectError) {
      return NextResponse.json({ error: "The Albert Heijn connection needs renewing.", code: "reconnect" }, { status: 409 });
    }
    if (e instanceof AhApiError) {
      return NextResponse.json({ error: "Couldn't reach Albert Heijn right now — your list here is unchanged." }, { status: 502 });
    }
    console.error("ah send failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
