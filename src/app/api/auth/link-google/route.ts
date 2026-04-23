import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

// Start a "link another Google account" OAuth flow. Unlike the primary
// sign-in flow (handled by Auth.js), this one *requires* an existing
// session — we're adding an identity to the user who's already logged in.
// The callback inserts a row into `accounts` against the current user so
// future sign-ins with either Google account land on the same app user.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const NONCE_COOKIE = "link_google_state";

export async function GET(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const clientId = process.env.AUTH_GOOGLE_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "Google OAuth isn't configured (AUTH_GOOGLE_ID missing)" },
        { status: 500 }
      );
    }

    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}/api/auth/link-google/callback`;

    // Opaque random state — we bind it to the session via a signed cookie so
    // an attacker can't forge a callback that attaches a Google identity to
    // the victim's user.
    const nonce = randomBytes(24).toString("base64url");
    const state = `${ctx.userId}.${nonce}`;

    const jar = await cookies();
    jar.set(NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600, // 10 minutes
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      // Force the account chooser so the user picks the *other* account,
      // not silently re-confirm the current one.
      prompt: "select_account",
      access_type: "online",
      state,
    });

    return NextResponse.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.redirect(new URL("/signin", req.url));
    }
    console.error("link-google init failed", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
