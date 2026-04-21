import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { householdInvites } from "@/lib/db/schema";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { randomToken } from "@/lib/utils";

export async function POST() {
  try {
    const ctx = await requireHouseholdMember();

    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(householdInvites).values({
      token,
      householdId: ctx.householdId,
      invitedByUserId: ctx.userId,
      expiresAt,
    });

    const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/onboarding?invite=${token}`;
    return NextResponse.json({ token, url, expiresAt });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("invite create failed", e);
    return NextResponse.json({ error: "Something went wrong, please try again." }, { status: 500 });
  }
}
