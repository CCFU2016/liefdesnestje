// Who may sign in. Pure decision logic so it can be unit-tested without
// NextAuth or the database; `config.ts` feeds it the lookups.
//
// Rules, in order:
//   1. An account that already exists may always sign in (never lock out a
//      current member because an env var changed).
//   2. Emails listed in ALLOWED_EMAILS may sign in (this is how you invite
//      a new person: add their address, then send them the household invite).
//   3. If there are no users at all, anyone may sign in — bootstrap for a
//      fresh deployment. The first sign-in closes this door.
//   Otherwise: denied.

export type SignInDecisionInput = {
  email: string | null | undefined;
  allowlist: ReadonlySet<string>;
  userExists: boolean;
  anyUsers: boolean;
};

export function normaliseEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 && e.includes("@") ? e : null;
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(/[,\s;]+/)) {
    const e = normaliseEmail(part);
    if (e) out.add(e);
  }
  return out;
}

export function isSignInAllowed(input: SignInDecisionInput): boolean {
  const email = normaliseEmail(input.email);
  if (!email) return false;
  if (input.userExists) return true;
  if (input.allowlist.has(email)) return true;
  if (!input.anyUsers) return true;
  return false;
}
