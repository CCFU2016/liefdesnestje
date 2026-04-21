import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, saveUpload, type ImageMime } from "@/lib/uploads";

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
    const mime = file.type as ImageMime;
    if (!IMAGE_MIME_TYPES.includes(mime)) {
      return NextResponse.json(
        { error: "Supported types: JPEG, PNG, GIF, WebP" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
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
