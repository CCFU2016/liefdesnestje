import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { householdMembers } from "@/lib/db/schema";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { getAhConnectionStatus } from "@/lib/ah/connection";
import { AH_LOGIN_URL } from "@/lib/ah/constants";

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const status = await getAhConnectionStatus(ctx.householdId);

    let connectedByName: string | null = null;
    if (status.connectedByUserId) {
      const rows = await db
        .select({ displayName: householdMembers.displayName })
        .from(householdMembers)
        .where(eq(householdMembers.userId, status.connectedByUserId))
        .limit(1);
      connectedByName = rows[0]?.displayName ?? null;
    }

    // Whoever connected it manages it. Anyone may connect when nothing is.
    const canManage = !status.connected || status.connectedByUserId === ctx.userId;

    return NextResponse.json({
      connected: status.connected,
      needsReconnect: status.needsReconnect,
      connectedByName,
      connectedByMe: status.connectedByUserId === ctx.userId,
      canManage,
      connectedAt: status.connectedAt,
      lastUsedAt: status.lastUsedAt,
      lastError: status.lastError,
      loginUrl: AH_LOGIN_URL,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("ah status failed", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
