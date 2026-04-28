import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { householdMembers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { MAX_IMAGE_BYTES, saveUpload } from "@/lib/uploads";
import { sniffMime } from "@/lib/file-magic";

export const maxDuration = 30;

const ALLOWED = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type Allowed = (typeof ALLOWED)[number];

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Avatar too large (max 10MB)" }, { status: 413 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime || !(ALLOWED as readonly string[]).includes(mime)) {
      return NextResponse.json(
        { error: "Avatar must be JPEG, PNG, GIF, or WebP." },
        { status: 400 }
      );
    }
    const ext =
      mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : mime === "image/webp" ? "webp" : "jpg";
    const { relPath } = await saveUpload({
      subdir: `avatars/${ctx.userId}`,
      filename: `avatar-${Date.now()}.${ext}`,
      bytes,
      mime: mime as Allowed,
    });

    // Update every household membership for this user (a user only ever
    // has one membership today, but the schema doesn't enforce that, and
    // the avatar should be consistent across any household they're in).
    const url = `/api/me/avatar/file?path=${encodeURIComponent(relPath)}`;
    await db
      .update(householdMembers)
      .set({ avatarUrl: url })
      .where(eq(householdMembers.userId, ctx.userId));

    return NextResponse.json({ avatarUrl: url });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("avatar upload failed", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const ctx = await requireHouseholdMember();
    await db
      .update(householdMembers)
      .set({ avatarUrl: null })
      .where(eq(householdMembers.userId, ctx.userId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Mark "use" so eslint doesn't complain about the imported and-helper —
// kept for future household-id scoping.
void and;
