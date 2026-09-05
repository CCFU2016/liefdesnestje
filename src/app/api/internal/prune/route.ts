import { NextResponse } from "next/server";
import { pruneOldData } from "@/lib/maintenance/prune";
import { requireCronSecret } from "@/lib/auth/cron";

// Housekeeping (old daily photos + their files, expired sessions, stale
// Claude usage rows). Called by the ICS refresh cron. It has to run here,
// inside the app, because the photo files live on the app's volume — a cron
// service has its own empty volume, so an unlink there would silently do
// nothing while the database row still got removed.
export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const result = await pruneOldData();
  console.log(
    `[prune] ${result.photosDeleted} photos (${result.photoFilesDeleted} files), ${result.sessionsDeleted} sessions, ${result.tokensDeleted} tokens, ${result.usageRowsDeleted} usage rows` +
      (result.errors.length ? `; errors: ${result.errors.join(" | ")}` : "")
  );
  return NextResponse.json(result, { status: result.errors.length ? 207 : 200 });
}
