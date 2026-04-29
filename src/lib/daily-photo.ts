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
  resolveBaseUrl,
} from "@/lib/icloud-shared-album";
import { extractGps, reverseGeocode } from "@/lib/photo-location";

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
  console.log("[daily-photo] starting pick for", householdId, "baseUrl cached?", !!baseUrl);
  try {
    if (!baseUrl) {
      console.log("[daily-photo] resolving base url");
      baseUrl = await resolveBaseUrl(album.albumToken);
      console.log("[daily-photo] resolved:", baseUrl);
    }
    try {
      console.log("[daily-photo] fetching webstream");
      webstream = await fetchWebstream(baseUrl);
    } catch (e) {
      if (e instanceof ICloudAlbumError) {
        console.log("[daily-photo] webstream failed, re-resolving:", e.message);
        baseUrl = await resolveBaseUrl(album.albumToken);
        webstream = await fetchWebstream(baseUrl);
      } else {
        throw e;
      }
    }
    console.log("[daily-photo] webstream ok,", webstream.photos.length, "photos");
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
  console.log("[daily-photo] picked guid", picked.photoGuid, "derivs:", Object.keys(picked.derivatives).length);

  // Apple's webasseturls response only contains URLs for a subset of a
  // photo's derivatives (the subset varies by photo). We fetch the URL
  // bundle first, then pick the best derivative *that actually has a URL*,
  // rather than picking a derivative up-front and hoping its URL is there.
  let bytes: Uint8Array;
  let mime: string;
  let chosenWidth: number | null = null;
  let chosenHeight: number | null = null;
  try {
    console.log("[daily-photo] fetching asset URLs");
    const urlBundle = await fetchAssetUrls(baseUrl, [picked.photoGuid]);
    console.log("[daily-photo] got", Object.keys(urlBundle._flat ?? {}).length, "signed URLs");
    const availableUrls = urlBundle._flat ?? {};
    const available = Object.entries(picked.derivatives)
      .filter(([label]) => label !== "PosterFrame" && !isNaN(parseInt(label, 10)))
      .filter(([, d]) => !!availableUrls[d.checksum])
      .map(([label, d]) => ({
        label,
        checksum: d.checksum,
        width: d.width,
        height: d.height,
        url: availableUrls[d.checksum]!,
      }))
      .sort((a, b) => b.width - a.width);

    if (available.length === 0) {
      console.warn(
        "[daily-photo] no derivative URL matched for guid",
        picked.photoGuid,
        "derivatives:",
        Object.keys(picked.derivatives),
        "urls:",
        Object.keys(availableUrls)
      );
      return fallback();
    }

    // Prefer widest <= 2048, else smallest available (still real).
    const under = available.find((c) => c.width <= 2048);
    const chosen = under ?? available[available.length - 1];
    chosenWidth = chosen.width || null;
    chosenHeight = chosen.height || null;
    console.log("[daily-photo] downloading derivative", chosen.label, `${chosen.width}x${chosen.height}`);

    const downloaded = await downloadAsset(chosen.url);
    bytes = downloaded.bytes;
    mime = downloaded.mime;
    console.log("[daily-photo] downloaded", bytes.byteLength, "bytes,", mime);
  } catch (e) {
    console.warn("[daily-photo] asset download failed", e instanceof Error ? e.message : String(e));
    return fallback();
  }
  const safeMime = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)
    ? mime
    : "image/jpeg";
  const ext = safeMime === "image/png" ? "png" : safeMime === "image/webp" ? "webp" : "jpg";
  console.log("[daily-photo] saving to disk");
  const { relPath } = await saveUpload({
    subdir: `daily-photos/${householdId}`,
    filename: `${ymd}.${ext}`,
    bytes,
    mime: safeMime,
  });
  console.log("[daily-photo] saved at", relPath);

  const contributor = [picked.contributorFirstName, picked.contributorLastName]
    .filter(Boolean)
    .join(" ")
    .trim() || null;
  const takenAt = picked.dateCreated ? new Date(picked.dateCreated) : null;

  // Best-effort location. EXIF GPS is usually stripped from shared-album
  // derivatives, but not always — if we find it, reverse-geocode so the
  // card shows "Amsterdam" rather than raw coords.
  let latitude: string | null = null;
  let longitude: string | null = null;
  let locationName: string | null = null;
  try {
    const gps = await extractGps(bytes);
    if (gps) {
      latitude = gps.latitude.toString();
      longitude = gps.longitude.toString();
      locationName = await reverseGeocode(gps.latitude, gps.longitude);
      console.log("[daily-photo] location", locationName ?? `(${latitude},${longitude})`);
    } else {
      console.log("[daily-photo] no GPS EXIF on this derivative");
    }
  } catch (e) {
    console.warn("[daily-photo] location lookup skipped", e instanceof Error ? e.message : String(e));
  }

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
      latitude,
      longitude,
      locationName,
      width: chosenWidth,
      height: chosenHeight,
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
