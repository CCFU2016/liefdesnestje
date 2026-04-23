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
    const [stateUserId, nonce] = state.split(".", 2);
    const jar = await cookies();
    const expected = jar.get(NONCE_COOKIE)?.value;
    jar.delete(NONCE_COOKIE);
    if (!expected || expected !== nonce || stateUserId !== ctx.userId) {
      return redirectWithFlash(origin, "bad_state");
    }

    const clientId = process.env.AUTH_GOOGLE_ID;
    const clientSecret = process.env.AUTH_GOOGLE_SECRET;
    if (!clientId || !clientSecret) return redirectWithFlash(origin, "not_configured");

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
    if (!idToken) return redirectWithFlash(origin, "no_id_token");
    const claims = decodeIdToken(idToken);
    if (!claims?.sub) return redirectWithFlash(origin, "no_subject");

    const existing = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, claims.sub)))
      .limit(1);
    // Already linked to THIS user — no-op.
    if (existing[0] && existing[0].userId === ctx.userId) {
      return redirectWithFlash(origin, "already");
    }
    // Linked to a DIFFERENT user: only safe to reclaim if that other user is
    // an orphan (no household memberships). Common case: the user briefly
    // signed in with this Google account before finishing onboarding, which
    // left a dangling user row. We delete the orphan + its cascade children
    // and reassign the account. If the other user *does* have memberships,
    // we refuse — collapsing two real users would wipe out their data.
    if (existing[0] && existing[0].userId !== ctx.userId) {
      const otherUserId = existing[0].userId;
      const otherMemberships = await db
        .select({ userId: householdMembers.userId })
        .from(householdMembers)
        .where(eq(householdMembers.userId, otherUserId))
        .limit(1);
      if (otherMemberships.length > 0) {
        return redirectWithFlash(origin, "in_use");
      }
      // Reclaim: delete orphan user (cascades to accounts + sessions).
      // Safer than an UPDATE because the orphan might have other stale rows.
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
