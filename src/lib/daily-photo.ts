import "server-only";
import { db } from "@/lib/db";
import { householdPhotoAlbums, photoOfTheDay } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { saveUpload } from "@/lib/uploads";
import {
  downloadAsset,
  fetchAssetUrls,
  fetchWebstream,
  ICloudAlbumError,
  pickBestDerivative,
  resolveBaseUrl,
} from "@/lib/icloud-shared-album";

// Reused from the upload lib's image MIMEs. We accept HEIC-rendered JPEGs.
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Returns the cached photo for the given household+date, or picks and
 * downloads a fresh one from the configured iCloud shared album. Returns null
 * if no album is configured or the album is empty.
 *
 * The last 30 days' chosen guids are excluded so we don't repeat a recent pick.
 */
export async function getOrPickDailyPhoto(
  householdId: string,
  date = new Date()
): Promise<(typeof photoOfTheDay.$inferSelect) | null> {
  const ymd = toYmd(date);

  const [cached] = await db
    .select()
    .from(photoOfTheDay)
    .where(and(eq(photoOfTheDay.householdId, householdId), eq(photoOfTheDay.date, ymd)))
    .limit(1);
  if (cached) return cached;

  const [album] = await db
    .select()
    .from(householdPhotoAlbums)
    .where(eq(householdPhotoAlbums.householdId, householdId))
    .limit(1);
  if (!album) return null;

  // Fallback used when anything downstream throws — keep the most recent
  // successful pick visible so the card never vanishes silently on a
  // transient iCloud hiccup.
  const fallback = async () => {
    const [prev] = await db
      .select()
      .from(photoOfTheDay)
      .where(eq(photoOfTheDay.householdId, householdId))
      .orderBy(desc(photoOfTheDay.date))
      .limit(1);
    return prev ?? null;
  };

  // Fetch the album's photo list, resolving the partition if we don't have
  // one cached yet or if the old one 330s.
  let baseUrl = album.baseUrl;
  let webstream: Awaited<ReturnType<typeof fetchWebstream>>;
  try {
    if (!baseUrl) baseUrl = await resolveBaseUrl(album.albumToken);
    try {
      webstream = await fetchWebstream(baseUrl);
    } catch (e) {
      if (e instanceof ICloudAlbumError) {
        // Re-resolve once in case Apple moved the album between partitions.
        baseUrl = await resolveBaseUrl(album.albumToken);
        webstream = await fetchWebstream(baseUrl);
      } else {
        throw e;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[daily-photo] iCloud fetch failed for household", householdId, msg);
    await db
      .update(householdPhotoAlbums)
      .set({ lastError: msg, updatedAt: new Date() })
      .where(eq(householdPhotoAlbums.householdId, householdId));
    return fallback();
  }

  // Only still-images — skip videos (we'd need poster frame download path).
  const images = webstream.photos.filter((p) => p.mediaAssetType === "image");
  if (images.length === 0) {
    await db
      .update(householdPhotoAlbums)
      .set({
        streamName: webstream.streamName,
        baseUrl,
        lastError: "Album has no still photos",
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(householdPhotoAlbums.householdId, householdId));
    return null;
  }

  // Avoid re-picking recent guids.
  const recent = await db
    .select({ guid: photoOfTheDay.photoGuid })
    .from(photoOfTheDay)
    .where(eq(photoOfTheDay.householdId, householdId))
    .orderBy(desc(photoOfTheDay.date))
    .limit(30);
  const excluded = new Set(recent.map((r) => r.guid));
  let pool = images.filter((p) => !excluded.has(p.photoGuid));
  if (pool.length === 0) pool = images; // fall back to full set if we've seen them all

  const picked = pool[Math.floor(Math.random() * pool.length)];
  const derivative = pickBestDerivative(picked);
  if (!derivative) {
    console.warn("[daily-photo] no usable derivative for", picked.photoGuid);
    return fallback();
  }

  // Resolve the signed URL for just this one checksum.
  let assetUrl: string | undefined;
  let bytes: Uint8Array;
  let mime: string;
  try {
    const urlBundle = await fetchAssetUrls(baseUrl, [picked.photoGuid]);
    assetUrl = urlBundle._flat?.[derivative.checksum];
    if (!assetUrl) {
      console.warn("[daily-photo] no signed url for checksum", derivative.checksum);
      return fallback();
    }
    const downloaded = await downloadAsset(assetUrl);
    bytes = downloaded.bytes;
    mime = downloaded.mime;
  } catch (e) {
    console.warn("[daily-photo] asset download failed", e instanceof Error ? e.message : String(e));
    return fallback();
  }
  const safeMime = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)
    ? mime
    : "image/jpeg";
  const ext = safeMime === "image/png" ? "png" : safeMime === "image/webp" ? "webp" : "jpg";
  const { relPath } = await saveUpload({
    subdir: `daily-photos/${householdId}`,
    filename: `${ymd}.${ext}`,
    bytes,
    mime: safeMime,
  });

  const contributor = [picked.contributorFirstName, picked.contributorLastName]
    .filter(Boolean)
    .join(" ")
    .trim() || null;
  const takenAt = picked.dateCreated ? new Date(picked.dateCreated) : null;

  // Atomic upsert — another concurrent request could have beaten us to this
  // date; in that case we take the losing row and discard our download.
  const [row] = await db
    .insert(photoOfTheDay)
    .values({
      householdId,
      date: ymd,
      photoGuid: picked.photoGuid,
      localPath: relPath,
      mimeType: safeMime,
      caption: picked.caption,
      contributorName: contributor,
      takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
    })
    .onConflictDoNothing()
    .returning();

  await db
    .update(householdPhotoAlbums)
    .set({
      streamName: webstream.streamName ?? album.streamName,
      baseUrl,
      lastError: null,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(householdPhotoAlbums.householdId, householdId));

  if (row) return row;
  // Conflict: someone else wrote it first — return theirs.
  const [winner] = await db
    .select()
    .from(photoOfTheDay)
    .where(and(eq(photoOfTheDay.householdId, householdId), eq(photoOfTheDay.date, ymd)))
    .limit(1);
  return winner ?? null;
}
