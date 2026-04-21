import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { consumeOAuthState, exchangeCode } from "@/lib/microsoft/oauth";
import { encrypt } from "@/lib/auth/encryption";
import { db } from "@/lib/db";
import { externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getMe } from "@/lib/microsoft/graph";
import { subscribeCalendar, syncCalendarEvents, syncCalendarList } from "@/lib/microsoft/sync";
import { calendars } from "@/lib/db/schema";
import { requireHouseholdMember } from "@/lib/auth/household";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (err) {
    return NextResponse.redirect(new URL(`/settings?ms_err=${encodeURIComponent(err)}`, appUrl));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?ms_err=missing_params", appUrl));
  }

  const session = await auth();
  const expectedUserId = await consumeOAuthState(state);
  if (!session?.user?.id || !expectedUserId || session.user.id !== expectedUserId) {
    return NextResponse.redirect(new URL("/settings?ms_err=invalid_state", appUrl));
  }

  try {
    const tokens = await exchangeCode(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // We need /me to get a stable identifier for the account.
    // Create a temporary account row first with a placeholder, then update.
    // Simpler: construct an in-memory 'tempId' via Graph by posting directly.
    // We'll fetch /me using a one-off Graph call with the raw access token.
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,mail", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!meRes.ok) throw new Error("Failed to call /me");
    const me = (await meRes.json()) as { id: string; userPrincipalName: string; mail?: string };

    // Upsert the account (unique on provider+externalAccountId)
    const existing = (
      await db
        .select()
        .from(externalCalendarAccounts)
        .where(
          and(
            eq(externalCalendarAccounts.provider, "microsoft"),
            eq(externalCalendarAccounts.externalAccountId, me.id)
          )
        )
        .limit(1)
    )[0];

    let accountId: string;
    if (existing) {
      accountId = existing.id;
      await db
        .update(externalCalendarAccounts)
        .set({
          userId: session.user.id,
          accessTokenEnc: encrypt(tokens.access_token),
          refreshTokenEnc: encrypt(tokens.refresh_token),
          expiresAt,
          scope: tokens.scope,
          updatedAt: new Date(),
        })
        .where(eq(externalCalendarAccounts.id, accountId));
    } else {
      const [inserted] = await db
        .insert(externalCalendarAccounts)
        .values({
          userId: session.user.id,
          provider: "microsoft",
          externalAccountId: me.id,
          accessTokenEnc: encrypt(tokens.access_token),
          refreshTokenEnc: encrypt(tokens.refresh_token),
          expiresAt,
          scope: tokens.scope,
        })
        .returning();
      accountId = inserted.id;
    }

    // Pull calendar list, sync default one, subscribe for push.
    await syncCalendarList(accountId);
    const defaults = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.accountId, accountId), eq(calendars.syncEnabled, true)));

    const ctx = await requireHouseholdMember().catch(() => null);
    if (ctx) {
      for (const c of defaults) {
        try {
          await syncCalendarEvents(accountId, c.id, ctx.householdId, ctx.userId);
          await subscribeCalendar(accountId, c.id);
        } catch (e) {
          console.error("initial sync/subscribe failed for", c.id, e);
        }
      }
    }
  } catch (e) {
    console.error("MS OAuth callback failed", e);
    return NextResponse.redirect(new URL("/settings?ms_err=callback_failed", appUrl));
  }

  return NextResponse.redirect(new URL("/settings?ms_ok=1", appUrl));
}
