import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

function decodeIdToken(idToken: string | null): { email: string | null } {
  if (!idToken) return { email: null };
  try {
    const [, payload] = idToken.split(".");
    if (!payload) return { email: null };
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    const parsed = JSON.parse(json) as { email?: string };
    return { email: parsed.email ?? null };
  } catch {
    return { email: null };
  }
}

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const rows = await db
      .select({
        provider: accounts.provider,
        providerAccountId: accounts.providerAccountId,
        id_token: accounts.id_token,
      })
      .from(accounts)
      .where(and(eq(accounts.userId, ctx.userId), eq(accounts.provider, "google")));
    const out = rows.map((r) => ({
      provider: r.provider,
      providerAccountId: r.providerAccountId,
      email: decodeIdToken(r.id_token).email,
    }));
    console.log("[linked-accounts] user=", ctx.userId, "count=", out.length);
    return NextResponse.json({ accounts: out }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500, headers: NO_STORE });
  }
}

const deleteSchema = z.object({ providerAccountId: z.string().min(1).max(200) });

export async function DELETE(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = deleteSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const mine = await db
      .select({ providerAccountId: accounts.providerAccountId })
      .from(accounts)
      .where(and(eq(accounts.userId, ctx.userId), eq(accounts.provider, "google")));
    if (mine.length <= 1) {
      return NextResponse.json(
        { error: "Can't unlink your last Google account — you'd lose the ability to sign in." },
        { status: 400 }
      );
    }
    if (!mine.find((m) => m.providerAccountId === body.data.providerAccountId)) {
      return NextResponse.json({ error: "Not your account" }, { status: 404 });
    }

    await db
      .delete(accounts)
      .where(
        and(
          eq(accounts.userId, ctx.userId),
          eq(accounts.provider, "google"),
          eq(accounts.providerAccountId, body.data.providerAccountId)
        )
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
