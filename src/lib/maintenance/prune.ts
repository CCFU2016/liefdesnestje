import { lt } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { claudeUsage, photoOfTheDay, sessions, verificationTokens } from "@/lib/db/schema";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Housekeeping for the tables and files that otherwise grow forever:
//   - daily photos (1–2 MB each; the 5 GB volume fills in ~7 years)
//   - expired Auth.js sessions and verification tokens
//   - the Claude usage ledger (only the current day matters for the cap)
// Triggered by the ICS refresh cron (every 6 h) via POST /api/internal/prune
// so it executes in the app container, where the photo files actually are.
// Every step is idempotent and isolated so one failure never blocks the others.

export type PruneResult = {
  photosDeleted: number;
  photoFilesDeleted: number;
  sessionsDeleted: number;
  tokensDeleted: number;
  usageRowsDeleted: number;
  errors: string[];
};

function ymdDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function pruneOldData(opts: { photoDays?: number; usageDays?: number } = {}): Promise<PruneResult> {
  const photoDays = opts.photoDays ?? 60;
  const usageDays = opts.usageDays ?? 90;
  const result: PruneResult = {
    photosDeleted: 0,
    photoFilesDeleted: 0,
    sessionsDeleted: 0,
    tokensDeleted: 0,
    usageRowsDeleted: 0,
    errors: [],
  };

  // Daily photos: delete the file first, then the row; a row whose file is
  // already gone is still removed (lib/daily-photo treats it as dead anyway).
  // The "don't repeat a recent pick" window is 30 rows, well inside 60 days.
  try {
    const old = await db
      .select({
        householdId: photoOfTheDay.householdId,
        date: photoOfTheDay.date,
        localPath: photoOfTheDay.localPath,
      })
      .from(photoOfTheDay)
      .where(lt(photoOfTheDay.date, ymdDaysAgo(photoDays)));
    for (const row of old) {
      try {
        await unlink(join(UPLOAD_ROOT, row.localPath));
        result.photoFilesDeleted++;
      } catch {
        /* already gone */
      }
      const { and, eq } = await import("drizzle-orm");
      await db
        .delete(photoOfTheDay)
        .where(and(eq(photoOfTheDay.householdId, row.householdId), eq(photoOfTheDay.date, row.date)));
      result.photosDeleted++;
    }
  } catch (e) {
    result.errors.push(`photos: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const now = new Date();
    result.sessionsDeleted = (await db.delete(sessions).where(lt(sessions.expires, now)).returning()).length;
    result.tokensDeleted = (
      await db.delete(verificationTokens).where(lt(verificationTokens.expires, now)).returning()
    ).length;
  } catch (e) {
    result.errors.push(`sessions: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const cutoff = new Date(Date.now() - usageDays * 24 * 60 * 60 * 1000);
    result.usageRowsDeleted = (
      await db.delete(claudeUsage).where(lt(claudeUsage.createdAt, cutoff)).returning()
    ).length;
  } catch (e) {
    result.errors.push(`claude_usage: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
