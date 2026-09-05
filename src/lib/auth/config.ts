import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  householdMembers,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { isSignInAllowed, normaliseEmail, parseAllowlist } from "./allowlist";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      householdId: string | null;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Trust the X-Forwarded-* headers set by Railway's proxy. Without this,
  // Auth.js constructs cookies against the internal service host rather
  // than the public *.up.railway.app host — the PKCE cookie gets written
  // under one host and read under another, and iOS Safari (stricter than
  // Chrome/Firefox about cross-host cookies in the OAuth callback) fails
  // with 'pkceCodeVerifier value could not be parsed'.
  trustHost: true,
  // Force secure cookies in every prod deploy so iOS Safari accepts them
  // during the Google redirect round-trip.
  useSecureCookies: process.env.NODE_ENV === "production",
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  callbacks: {
    // Gate who may create an account. Any Google account can complete the
    // OAuth dance; without this, strangers could sign up and spend the
    // Claude budget / fill the uploads volume. See ./allowlist.ts for the
    // rules. Returning false sends the browser to pages.error (/signin).
    async signIn({ user, profile }) {
      const email = normaliseEmail(user.email ?? (profile?.email as string | undefined));
      if (!email) {
        console.warn("[auth] sign-in denied: provider returned no email");
        return false;
      }
      try {
        const [existing, [{ n }]] = await Promise.all([
          db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
          db.select({ n: sql<number>`count(*)::int` }).from(users),
        ]);
        const allowed = isSignInAllowed({
          email,
          allowlist: parseAllowlist(process.env.ALLOWED_EMAILS),
          userExists: existing.length > 0,
          anyUsers: n > 0,
        });
        if (!allowed) console.warn("[auth] sign-in denied: address not allowlisted");
        return allowed;
      } catch (e) {
        // Fail closed: if we cannot check, do not let a new account in.
        console.error("[auth] signIn callback: allowlist lookup failed", e);
        return false;
      }
    },
    async session({ session, user }) {
      session.user.id = user.id;
      // Don't 500 the whole sign-in flow if the membership lookup fails —
      // fall back to null and let the app handle it (user gets routed to
      // /onboarding rather than a raw server error).
      try {
        const membership = await db
          .select({ householdId: householdMembers.householdId })
          .from(householdMembers)
          .where(eq(householdMembers.userId, user.id))
          .limit(1);
        session.user.householdId = membership[0]?.householdId ?? null;
      } catch (e) {
        console.error("[auth] session callback: household lookup failed", e);
        session.user.householdId = null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/signin",
    // When the OAuth callback throws (bad PKCE cookie, state mismatch, etc.)
    // route back to /signin rather than the default error page — iOS users
    // just want a retry button.
    error: "/signin",
  },
  logger: {
    error(error: Error) {
      console.error("[auth] error:", error.message, error.stack);
    },
    warn(code: string) {
      console.warn("[auth] warn:", code);
    },
  },
});
