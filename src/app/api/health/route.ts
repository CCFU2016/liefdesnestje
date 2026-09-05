import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { stat } from "node:fs/promises";
import { db } from "@/lib/db";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Liveness + the two dependencies that silently break: the database and
// the uploads volume. Unauthenticated on purpose (it reveals nothing but
// up/down) so Railway's health check or an external pinger can use it.
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | string> = {};

  try {
    await db.execute(sql`select 1`);
    checks.db = "ok";
  } catch (e) {
    checks.db = e instanceof Error ? e.message.slice(0, 120) : "error";
  }

  try {
    const st = await stat(UPLOAD_ROOT);
    checks.uploads = st.isDirectory() ? "ok" : "not a directory";
  } catch {
    checks.uploads = "missing";
  }

  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { ok, checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
