import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";
import { getBonusTags } from "@/lib/ah/bonus";

const bodySchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).max(200),
});

// Which of these ingredient names map to a remembered AH product that is
// in bonus this week. Decoration only: any AH trouble yields an empty map.
export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const tooBig = rejectIfTooLarge(req, MAX_JSON_BYTES);
    if (tooBig) return tooBig;
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const bonus = await getBonusTags(ctx.householdId, parsed.data.names);
    return NextResponse.json({ bonus });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("ah bonus failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ bonus: {} });
  }
}
