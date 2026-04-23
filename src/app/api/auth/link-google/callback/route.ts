import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

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

function redirectWithFlash(req: Request, slug: "ok" | string): NextResponse {
  const u = new URL("/settings", req.url);
  u.hash = "accounts";
  u.searchParams.set("linked", slug);
  return NextResponse.redirect(u);
}

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const gError = url.searchParams.get("error");
    if (gError) return redirectWithFlash(req, gError);
    if (!code || !state) return redirectWithFlash(req, "missing_code");

    // Verify state matches the cookie nonce AND encodes the current user.
    const [stateUserId, nonce] = state.split(".", 2);
    const jar = await cookies();
    const expected = jar.get(NONCE_COOKIE)?.value;
    jar.delete(NONCE_COOKIE);
    if (!expected || expected !== nonce || stateUserId !== ctx.userId) {
      return redirectWithFlash(req, "bad_state");
    }

    const clientId = process.env.AUTH_GOOGLE_ID;
    const clientSecret = process.env.AUTH_GOOGLE_SECRET;
    if (!clientId || !clientSecret) return redirectWithFlash(req, "not_configured");

    const redirectUri = `${url.origin}/api/auth/link-google/callback`;

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
      return redirectWithFlash(req, "token_failed");
    }

    const idToken = tokens.id_token;
    if (!idToken) return redirectWithFlash(req, "no_id_token");
    const claims = decodeIdToken(idToken);
    if (!claims?.sub) return redirectWithFlash(req, "no_subject");

    // Reject linking a Google account that's already attached to a DIFFERENT
    // app user — otherwise we'd silently merge two households.
    const existing = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, claims.sub)))
      .limit(1);
    if (existing[0] && existing[0].userId !== ctx.userId) {
      return redirectWithFlash(req, "in_use");
    }
    // If it's already linked to THIS user, nothing to do.
    if (existing[0] && existing[0].userId === ctx.userId) {
      return redirectWithFlash(req, "already");
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

    return redirectWithFlash(req, "ok");
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.redirect(new URL("/signin", req.url));
    }
    console.error("link-google callback failed", e);
    return redirectWithFlash(req, "error");
  }
}
