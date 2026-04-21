import { cookies } from "next/headers";
import { randomToken } from "@/lib/utils";

const AUTHORIZE_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";
const SCOPES = ["Calendars.ReadWrite", "offline_access", "User.Read"];

function cfg() {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const tenant = process.env.MS_TENANT_ID ?? "common";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  if (!clientId || !clientSecret) {
    throw new Error("MS_CLIENT_ID and MS_CLIENT_SECRET must be set");
  }
  return {
    clientId,
    clientSecret,
    tenant,
    redirectUri: `${appUrl}/api/integrations/microsoft/callback`,
  };
}

export async function beginOAuth(userId: string): Promise<string> {
  const { clientId, tenant, redirectUri } = cfg();
  const state = randomToken(24);
  const nonce = randomToken(16);

  const jar = await cookies();
  jar.set("ms_oauth_state", `${state}.${userId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const u = new URL(AUTHORIZE_URL.replace("{tenant}", tenant));
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export async function exchangeCode(code: string): Promise<TokenBundle> {
  const { clientId, clientSecret, tenant, redirectUri } = cfg();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: SCOPES.join(" "),
  });
  const res = await fetch(TOKEN_URL.replace("{tenant}", tenant), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MS token exchange failed: ${res.status} ${err}`);
  }
  return (await res.json()) as TokenBundle;
}

export async function refreshTokens(refreshToken: string): Promise<TokenBundle> {
  const { clientId, clientSecret, tenant } = cfg();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES.join(" "),
  });
  const res = await fetch(TOKEN_URL.replace("{tenant}", tenant), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MS token refresh failed: ${res.status} ${err}`);
  }
  return (await res.json()) as TokenBundle;
}

export async function consumeOAuthState(returnedState: string): Promise<string | null> {
  const jar = await cookies();
  const cookie = jar.get("ms_oauth_state")?.value;
  jar.delete("ms_oauth_state");
  if (!cookie) return null;
  const [expected, userId] = cookie.split(".");
  if (!expected || !userId) return null;
  if (expected !== returnedState) return null;
  return userId;
}
