import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, households, householdMembers, todoLists, accounts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

// DEV ONLY. Gated by NODE_ENV !== production AND ALLOW_DEV_LOGIN=1.
// Creates (or reuses) a demo user + household and sets an Auth.js session cookie,
// so you can see the app before wiring up real Google OAuth.

function assertAllowed(req: Request) {
  if (process.env.NODE_ENV === "production") throw new Error("disabled in production");
  if (process.env.ALLOW_DEV_LOGIN !== "1") throw new Error("ALLOW_DEV_LOGIN must be '1'");
  // Defense in depth: even if the two env guards are misconfigured (e.g. a
  // preview deployment accidentally sets ALLOW_DEV_LOGIN=1), only allow the
  // dev-login flow from a local origin. This protects against an attacker
  // bypassing the signin page entirely by POSTing to this endpoint.
  const host = new URL(req.url).hostname;
  const allowed = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  if (!allowed) throw new Error(`dev login blocked on non-local host: ${host}`);
}

export async function POST(req: Request) {
  try {
    assertAllowed(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { as?: "niki" | "partner" };
  const who = body.as ?? "niki";

  const email = who === "partner" ? "partner@dev.local" : "niki@dev.local";
  const name = who === "partner" ? "Partner" : "Niki";
  const color = who === "partner" ? "#e11d48" : "#4f46e5";

  // Ensure user exists
  let user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user) {
    [user] = await db.insert(users).values({ email, name }).returning();
    await db.insert(accounts).values({
      userId: user.id,
      type: "oauth",
      provider: "dev",
      providerAccountId: email,
    });
  }

  // Ensure membership in a shared household
  const myMember = (
    await db.select().from(householdMembers).where(eq(householdMembers.userId, user.id)).limit(1)
  )[0];

  if (!myMember) {
    // Reuse an existing demo household if present; otherwise create one.
    const existingHouseholds = await db.select().from(households).limit(1);
    let hh = existingHouseholds[0];
    if (!hh) {
      [hh] = await db.insert(households).values({ name: "Our nest" }).returning();
      await db.insert(todoLists).values({ householdId: hh.id, name: "Inbox", sortOrder: 0 });
      await db.insert(todoLists).values({ householdId: hh.id, name: "Groceries", sortOrder: 1 });
    }
    // Avoid color collision
    const existingColors = new Set(
      (await db.select().from(householdMembers).where(eq(householdMembers.householdId, hh.id))).map((m) => m.color)
    );
    const pickedColor = existingColors.has(color)
      ? color === "#4f46e5" ? "#e11d48" : "#4f46e5"
      : color;

    await db.insert(householdMembers).values({
      userId: user.id,
      householdId: hh.id,
      role: existingHouseholds.length === 0 ? "owner" : "member",
      displayName: name,
      color: pickedColor,
    });
  }

  // Create a session row + cookie (Auth.js database strategy)
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ sessionToken: token, userId: user.id, expires });

  const jar = await cookies();
  jar.set("authjs.session-token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires,
  });

  return NextResponse.json({ ok: true, userId: user.id, email });
}
