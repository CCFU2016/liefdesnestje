import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-eq";

// Shared-secret gate for endpoints that only our own cron services call
// (daily-photo prewarm, backup archive). These run as separate Railway
// services with their own volumes, so the work has to happen inside the app
// process where the uploads volume is mounted.
//
// Returns a Response to send back when the request is not authorised, or
// null when it is. Usage:
//   const denied = requireCronSecret(req); if (denied) return denied;
export function requireCronSecret(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !timingSafeEqualStr(token, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
