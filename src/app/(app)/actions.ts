"use server";

import { signOut } from "@/lib/auth/config";

// Auth.js v5's default POST /api/auth/signout requires a CSRF token which
// a plain <form> doesn't include; the form would submit but the session
// wouldn't actually be cleared. Exposing signOut as a server action gives
// us the "real" signout that Auth.js uses internally.
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
