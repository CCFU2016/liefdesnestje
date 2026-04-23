import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { accounts, householdMembers, sessions, users } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { getLinkGoogleRedirectUri, getPublicOrigin } from "../redirect-uri";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const NONCE_COOKIE = "link_google_state";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

type IdTokenClaims = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

function decodeIdToken(idToken: string): IdTokenClaims | null {
  try {
    const [, payload] = idToken.split(".");
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

function redirectWithFlash(origin: string, slug: "ok" | string): NextResponse {
  const u = new URL("/settings", origin);
  u.hash = "accounts";
  u.searchParams.set("linked", slug);
  return NextResponse.redirect(u);
}

export async function GET(req: Request) {
  const hdrs = await headers();
  const origin = getPublicOrigin(hdrs, req.url);
  console.log("[link-google] callback hit; origin=", origin);
  try {
    const ctx = await requireHouseholdMember();
    console.log("[link-google] authed as user", ctx.userId);
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const gError = url.searchParams.get("error");
    if (gError) {
      console.warn("[link-google] google error param:", gError);
      return redirectWithFlash(origin, gError);
    }
    if (!code || !state) {
      console.warn("[link-google] missing code or state");
      return redirectWithFlash(origin, "missing_code");
    }

    // Verify state matches the cookie nonce AND encodes the current user.
    // State format: "<userId>.<S|F>.<nonce>" — F means "force-replace any
    // conflicting other profile" (set explicitly via ?force=1 on initiate).
    // Older state values (without flag, just "<userId>.<nonce>") are still
    // accepted with force=false for backward compat across deploys.
    const stateParts = state.split(".");
    let stateUserId: string;
    let force = false;
    let nonce: string;
    if (stateParts.length === 3) {
      [stateUserId, , nonce] = stateParts;
      force = stateParts[1] === "F";
    } else {
      [stateUserId, nonce] = stateParts;
    }
    const jar = await cookies();
    const expected = jar.get(NONCE_COOKIE)?.value;
    jar.delete(NONCE_COOKIE);
    if (!expected || expected !== nonce || stateUserId !== ctx.userId) {
      console.warn("[link-google] bad_state — expectedCookie?", !!expected, "nonceMatch?", expected === nonce, "userMatch?", stateUserId === ctx.userId);
      return redirectWithFlash(origin, "bad_state");
    }
    console.log("[link-google] state ok, force=", force);

    const clientId = process.env.AUTH_GOOGLE_ID;
    const clientSecret = process.env.AUTH_GOOGLE_SECRET;
    if (!clientId || !clientSecret) {
      console.warn("[link-google] not_configured — missing AUTH_GOOGLE_ID or AUTH_GOOGLE_SECRET");
      return redirectWithFlash(origin, "not_configured");
    }

    const redirectUri = getLinkGoogleRedirectUri(hdrs, req.url);

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const tokens = (await tokenRes.json()) as TokenResponse;
    if (!tokenRes.ok || tokens.error) {
      console.warn("[link-google] token exchange failed", tokens.error, tokens.error_description);
      return redirectWithFlash(origin, "token_failed");
    }

    const idToken = tokens.id_token;
    if (!idToken) {
      console.warn("[link-google] no_id_token in token response");
      return redirectWithFlash(origin, "no_id_token");
    }
    const claims = decodeIdToken(idToken);
    if (!claims?.sub) {
      console.warn("[link-google] no_subject in id_token claims");
      return redirectWithFlash(origin, "no_subject");
    }
    console.log("[link-google] got claims for sub", claims.sub, "email", claims.email);

    const existing = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, claims.sub)))
      .limit(1);
    console.log("[link-google] existing account row?", existing.length > 0, "userId:", existing[0]?.userId);
    if (existing[0] && existing[0].userId === ctx.userId) {
      console.log("[link-google] already linked to this user — no-op");
      return redirectWithFlash(origin, "already");
    }
    if (existing[0] && existing[0].userId !== ctx.userId) {
      const otherUserId = existing[0].userId;
      const otherMemberships = await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(eq(householdMembers.userId, otherUserId))
        .limit(1);
      console.log("[link-google] account belongs to other user", otherUserId, "memberships:", otherMemberships.length);
      if (otherMemberships.length > 0 && !force) {
        console.warn("[link-google] in_use — refusing to merge real users (no force flag)");
        return redirectWithFlash(origin, "in_use");
      }
      if (force && otherMemberships.length > 0) {
        console.warn("[link-google] FORCE replacing other user", otherUserId, "with", ctx.userId);
      } else {
        console.log("[link-google] reclaiming orphan user", otherUserId);
      }
      // Delete the other user (cascades to their accounts, sessions,
      // household memberships, and any other rows FK'd to users.id).
      await db.delete(sessions).where(eq(sessions.userId, otherUserId));
      await db.delete(users).where(eq(users.id, otherUserId));
    }

    await db.insert(accounts).values({
      userId: ctx.userId,
      type: "oauth",
      provider: "google",
      providerAccountId: claims.sub,
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: tokens.expires_in ? Math.floor(Date.now() / 1000) + tokens.expires_in : null,
      token_type: tokens.token_type ?? null,
      scope: tokens.scope ?? null,
      id_token: idToken,
    });
    console.log("[link-google] inserted account row for user", ctx.userId, "sub", claims.sub);

    return redirectWithFlash(origin, "ok");
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.redirect(`${origin}/signin`);
    }
    console.error("link-google callback failed", e);
    return redirectWithFlash(origin, "error");
  }
}
