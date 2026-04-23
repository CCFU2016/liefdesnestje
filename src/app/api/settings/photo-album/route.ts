import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { householdPhotoAlbums, photoOfTheDay } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  fetchWebstream,
  ICloudAlbumError,
  parseAlbumToken,
  resolveBaseUrl,
} from "@/lib/icloud-shared-album";

export const maxDuration = 30;

const putSchema = z.object({ shareUrl: z.string().min(1).max(500) });

export async function GET() {
  try {
    const ctx = await requireHouseholdMember();
    const [row] = await db
      .select()
      .from(householdPhotoAlbums)
      .where(eq(householdPhotoAlbums.householdId, ctx.householdId))
      .limit(1);
    return NextResponse.json({ album: row ?? null });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const body = putSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const token = parseAlbumToken(body.data.shareUrl);
    if (!token) {
      return NextResponse.json(
        { error: "That doesn't look like an iCloud shared album URL." },
        { status: 400 }
      );
    }

    // Validate by actually fetching the stream metadata.
    let baseUrl: string;
    let streamName: string | null = null;
    let photoCount = 0;
    try {
      baseUrl = await resolveBaseUrl(token);
      const ws = await fetchWebstream(baseUrl);
      streamName = ws.streamName;
      photoCount = ws.photos.length;
    } catch (e) {
      const msg = e instanceof ICloudAlbumError ? e.message : "Couldn't reach the album.";
      return NextResponse.json(
        { error: `${msg} Make sure the album is shared with a public link.` },
        { status: 400 }
      );
    }

    await db
      .insert(householdPhotoAlbums)
      .values({
        householdId: ctx.householdId,
        shareUrl: body.data.shareUrl.trim(),
        albumToken: token,
        baseUrl,
        streamName,
        lastError: null,
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: householdPhotoAlbums.householdId,
        set: {
          shareUrl: body.data.shareUrl.trim(),
          albumToken: token,
          baseUrl,
          streamName,
          lastError: null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    // Changing the album clears today's cached pick so the next page view
    // grabs from the new album rather than showing a photo from the old one.
    await db.delete(photoOfTheDay).where(eq(photoOfTheDay.householdId, ctx.householdId));

    return NextResponse.json({ ok: true, streamName, photoCount });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const ctx = await requireHouseholdMember();
    await db
      .delete(householdPhotoAlbums)
      .where(eq(householdPhotoAlbums.householdId, ctx.householdId));
    await db.delete(photoOfTheDay).where(eq(photoOfTheDay.householdId, ctx.householdId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
