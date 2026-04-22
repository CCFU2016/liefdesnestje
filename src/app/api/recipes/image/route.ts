import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, saveUpload, type ImageMime } from "@/lib/uploads";
import { sniffMime } from "@/lib/file-magic";

export const maxDuration = 30;

// Simple image upload — no Claude extraction. Used for setting a recipe's
// hero photo when the user has a picture of the dish itself (not the recipe
// text). Returns the app-served URL ready to drop into a recipe's imageUrl.
export async function POST(req: Request) {
  try {
    await requireHouseholdMember();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large (max 10MB)" }, { status: 413 });
    }
    const claimed = file.type as ImageMime;
    if (!IMAGE_MIME_TYPES.includes(claimed)) {
      return NextResponse.json(
        { error: "Supported types: JPEG, PNG, GIF, WebP" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Trust magic bytes over the client-supplied MIME: a spoofed Content-Type
    // on a binary blob is the classic path to serving HTML or SVG as "image".
    const sniffed = sniffMime(bytes);
    if (!sniffed || !IMAGE_MIME_TYPES.includes(sniffed as ImageMime)) {
      return NextResponse.json(
        { error: "File doesn't look like a real JPEG/PNG/GIF/WebP image." },
        { status: 400 }
      );
    }
    const mime = sniffed as ImageMime;
    const { relPath } = await saveUpload({ subdir: "recipes", bytes, mime });
    const imageUrl = `/api/uploads/recipes/${relPath.split("/").slice(1).join("/")}`;
    return NextResponse.json({ imageUrl });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("upload recipe image failed", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
