import { NextResponse } from "next/server";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  extractRecipeFromImage,
  ExtractionBudgetError,
  ClaudeNotConfiguredError,
} from "@/lib/claude";
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, saveUpload, type ImageMime } from "@/lib/uploads";
import { sniffMime } from "@/lib/file-magic";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large (max 10MB)" }, { status: 413 });
    }
    if (!IMAGE_MIME_TYPES.includes(file.type as ImageMime)) {
      return NextResponse.json(
        { error: "Supported types: JPEG, PNG, GIF, WebP" },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Magic-byte check — don't send whatever the client claims to Claude.
    const sniffed = sniffMime(bytes);
    if (!sniffed || !IMAGE_MIME_TYPES.includes(sniffed as ImageMime)) {
      return NextResponse.json(
        { error: "File doesn't look like a real JPEG/PNG/GIF/WebP image." },
        { status: 400 }
      );
    }
    const mime = sniffed as ImageMime;

    // Save to the upload volume so we have a persistent reference.
    const { relPath } = await saveUpload({ subdir: "recipes", bytes, mime });
    const imageUrl = `/api/uploads/recipes/${relPath.split("/").slice(1).join("/")}`;

    const base64 = Buffer.from(bytes).toString("base64");
    const recipe = await extractRecipeFromImage({
      imageBase64: base64,
      mediaType: mime,
      userId: ctx.userId,
      hintText: file.name ? `Filename: ${file.name}` : undefined,
    });

    return NextResponse.json({ recipe: { ...recipe, imageUrl } });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof ClaudeNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    if (e instanceof ExtractionBudgetError) {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    console.error("extract-image failed", e);
    return NextResponse.json(
      { error: "Couldn't read that image — try again or fill in manually." },
      { status: 500 }
    );
  }
}
