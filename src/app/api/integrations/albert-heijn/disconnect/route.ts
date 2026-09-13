import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { disconnectHousehold, getAhConnectionStatus } from "@/lib/ah/connection";

export async function DELETE() {
  try {
    const ctx = await requireHouseholdMember();
    const status = await getAhConnectionStatus(ctx.householdId);
    if (!status.connected) return NextResponse.json({ ok: true });
    if (status.connectedByUserId && status.connectedByUserId !== ctx.userId && ctx.role !== "owner") {
      return NextResponse.json({ error: "Only the person who connected Albert Heijn can disconnect it." }, { status: 403 });
    }
    await disconnectHousehold(ctx.householdId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("ah disconnect failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
