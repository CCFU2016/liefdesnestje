import { cookies } from "next/headers";
import { randomToken } from "@/lib/utils";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function cfg() {
  // Prefer dedicated calendar client, fall back to the sign-in Google client
  // (same project, same OAuth client — just a second redirect URI).
  const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET (or AUTH_GOOGLE_ID/SECRET) must be set");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/api/integrations/google/callback`,
  };
}

export async function beginOAuth(userId: string): Promise<string> {
  const { clientId, redirectUri } = cfg();
  const state = randomToken(24);

  const jar = await cookies();
  jar.set("google_oauth_state", `${state}.${userId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // get refresh_token
  u.searchParams.set("prompt", "consent"); // always return refresh_token (Google omits it on re-auth)
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export type TokenBundle = {
  access_token: string;
  refresh_token?: string; // only on first consent (or with prompt=consent)
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string): Promise<TokenBundle> {
  const { clientId, clientSecret, redirectUri } = cfg();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenBundle;
}

export async function refreshTokens(refreshToken: string): Promise<TokenBundle> {
  const { clientId, clientSecret } = cfg();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenBundle;
}

export async function consumeOAuthState(returnedState: string): Promise<string | null> {
  const jar = await cookies();
  const cookie = jar.get("google_oauth_state")?.value;
  jar.delete("google_oauth_state");
  if (!cookie) return null;
  const [expected, userId] = cookie.split(".");
  if (!expected || !userId) return null;
  if (expected !== returnedState) return null;
  return userId;
}
