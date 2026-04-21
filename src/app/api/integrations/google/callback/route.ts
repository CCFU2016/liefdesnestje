import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { consumeOAuthState, exchangeCode } from "@/lib/google/oauth";
import { encrypt } from "@/lib/auth/encryption";
import { db } from "@/lib/db";
import { calendars, externalCalendarAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getMe } from "@/lib/google/api";
import { subscribeCalendar, syncCalendarEvents, syncCalendarList } from "@/lib/google/sync";
import { requireHouseholdMember } from "@/lib/auth/household";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (err) {
    return NextResponse.redirect(new URL(`/settings?google_err=${encodeURIComponent(err)}`, appUrl));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/settings?google_err=missing_params", appUrl));
  }

  const session = await auth();
  const expectedUserId = await consumeOAuthState(state);
  if (!session?.user?.id || !expectedUserId || session.user.id !== expectedUserId) {
    return NextResponse.redirect(new URL("/settings?google_err=invalid_state", appUrl));
  }

  try {
    const tokens = await exchangeCode(code);

    // Google doesn't always return refresh_token on re-consent; if missing, we can't
    // store the account (we need offline access). Prompt user to reconnect.
    if (!tokens.refresh_token) {
      // Ask Google for a refresh token next time by revoking and reconnecting
      return NextResponse.redirect(new URL("/settings?google_err=no_refresh_token", appUrl));
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Identify the Google user via userinfo
    const userinfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userinfoRes.ok) throw new Error("Failed to call userinfo");
    const me = (await userinfoRes.json()) as { email: string; sub: string };

    // Upsert the external account (keyed on provider + externalAccountId)
    const existing = (
      await db
        .select()
        .from(externalCalendarAccounts)
        .where(
          and(
            eq(externalCalendarAccounts.provider, "google"),
            eq(externalCalendarAccounts.externalAccountId, me.sub)
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
          provider: "google",
          externalAccountId: me.sub,
          accessTokenEnc: encrypt(tokens.access_token),
          refreshTokenEnc: encrypt(tokens.refresh_token),
          expiresAt,
          scope: tokens.scope,
        })
        .returning();
      accountId = inserted.id;
    }

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
          // Only subscribe if NEXT_PUBLIC_APP_URL is publicly reachable (Google
          // requires HTTPS + domain verification for webhooks). Skip if localhost.
          const publicUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
          if (publicUrl.startsWith("https://") && !publicUrl.includes("localhost")) {
            await subscribeCalendar(accountId, c.id);
          }
        } catch (e) {
          console.error("initial google sync/subscribe failed for", c.id, e);
        }
      }
    }
  } catch (e) {
    console.error("Google OAuth callback failed", e);
    return NextResponse.redirect(new URL("/settings?google_err=callback_failed", appUrl));
  }

  return NextResponse.redirect(new URL("/settings?google_ok=1", appUrl));
}
