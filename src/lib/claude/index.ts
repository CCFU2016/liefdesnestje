import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  AggregatedListSchema,
  ExtractedRecipeSchema,
  SocialExtractionSchema,
  type AggregatedList,
  type ExtractedRecipe,
  type SocialExtraction,
} from "./schemas";
import {
  INGREDIENT_AGGREGATION_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
  SOCIAL_CAPTION_SYSTEM_PROMPT,
} from "./prompts";
import { assertWithinDailyCap, recordUsage } from "./rate-limit";

// Model: sticking with what the v2 brief specified explicitly.
const MODEL = "claude-sonnet-4-6";

let clientSingleton: Anthropic | null = null;
function client(): Anthropic {
  if (clientSingleton) return clientSingleton;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeNotConfiguredError();
  }
  clientSingleton = new Anthropic({ apiKey });
  return clientSingleton;
}

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("Recipe extraction is not configured — ANTHROPIC_API_KEY missing");
    this.name = "ClaudeNotConfiguredError";
  }
}

if (!process.env.ANTHROPIC_API_KEY && process.env.NODE_ENV === "production") {
  console.warn("[claude] ANTHROPIC_API_KEY not set — extraction endpoints will 500");
}

// --- extractRecipeFromText ---

export async function extractRecipeFromText(
  text: string,
  userId: string
): Promise<ExtractedRecipe> {
  await assertWithinDailyCap(userId);
  const started = Date.now();
  const inputBytes = Buffer.byteLength(text, "utf8");
  try {
    const resp = await client().messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: RECIPE_SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(ExtractedRecipeSchema) },
      messages: [{ role: "user", content: text }],
    });
    if (!resp.parsed_output) throw new Error("Claude returned no parsed output");
    await recordUsage({
      userId,
      callType: "extract-text",
      success: true,
      inputSizeBytes: inputBytes,
      outputSizeBytes: JSON.stringify(resp.parsed_output).length,
      latencyMs: Date.now() - started,
    });
    return resp.parsed_output;
  } catch (e) {
    await recordUsage({
      userId,
      callType: "extract-text",
      success: false,
      inputSizeBytes: inputBytes,
      outputSizeBytes: 0,
      latencyMs: Date.now() - started,
    });
    throw e;
  }
}

// --- extractRecipeFromImage ---

export async function extractRecipeFromImage(input: {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  userId: string;
  hintText?: string;
}): Promise<ExtractedRecipe> {
  await assertWithinDailyCap(input.userId);
  const started = Date.now();
  const inputBytes = input.imageBase64.length; // approximate
  try {
    const resp = await client().messages.parse({
      model: MODEL,
      max_tokens: 4000, // cookbook pages can be long
      system: RECIPE_SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(ExtractedRecipeSchema) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType,
                data: input.imageBase64,
              },
            },
            {
              type: "text",
              text: input.hintText
                ? `Extract the recipe from this image. Context: ${input.hintText}`
                : "Extract the recipe from this image.",
            },
          ],
        },
      ],
    });
    if (!resp.parsed_output) throw new Error("Claude returned no parsed output");
    await recordUsage({
      userId: input.userId,
      callType: "extract-image",
      success: true,
      inputSizeBytes: inputBytes,
      outputSizeBytes: JSON.stringify(resp.parsed_output).length,
      latencyMs: Date.now() - started,
    });
    return resp.parsed_output;
  } catch (e) {
    await recordUsage({
      userId: input.userId,
      callType: "extract-image",
      success: false,
      inputSizeBytes: inputBytes,
      outputSizeBytes: 0,
      latencyMs: Date.now() - started,
    });
    throw e;
  }
}

// --- extractRecipeFromCaption (social media) ---

export async function extractRecipeFromCaption(
  caption: string,
  userId: string,
  sourceHint?: { platform: "tiktok" | "instagram"; author?: string; title?: string }
): Promise<SocialExtraction> {
  await assertWithinDailyCap(userId);
  const started = Date.now();
  const inputBytes = Buffer.byteLength(caption, "utf8");

  const prefix = sourceHint
    ? `[Source: ${sourceHint.platform}${sourceHint.author ? ` by ${sourceHint.author}` : ""}${sourceHint.title ? ` — ${sourceHint.title}` : ""}]\n\n`
    : "";

  try {
    const resp = await client().messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: SOCIAL_CAPTION_SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(SocialExtractionSchema) },
      messages: [{ role: "user", content: prefix + caption }],
    });
    if (!resp.parsed_output) throw new Error("Claude returned no parsed output");
    await recordUsage({
      userId,
      callType: "extract-social",
      success: true,
      inputSizeBytes: inputBytes,
      outputSizeBytes: JSON.stringify(resp.parsed_output).length,
      latencyMs: Date.now() - started,
    });
    return resp.parsed_output;
  } catch (e) {
    await recordUsage({
      userId,
      callType: "extract-social",
      success: false,
      inputSizeBytes: inputBytes,
      outputSizeBytes: 0,
      latencyMs: Date.now() - started,
    });
    throw e;
  }
}

// --- aggregateIngredients ---

export type AggregateInput = {
  recipeTitle: string;
  servings: number; // number of servings we're cooking (already scaled)
  recipeDefaultServings: number; // how many servings the recipe was written for
  ingredients: Array<{
    quantity: string | null;
    unit: string | null;
    name: string;
    notes?: string | null;
  }>;
};

export async function aggregateIngredients(
  groups: AggregateInput[],
  userId: string
): Promise<AggregatedList> {
  await assertWithinDailyCap(userId);
  const started = Date.now();
  const payload = JSON.stringify(groups);
  const inputBytes = Buffer.byteLength(payload, "utf8");

  try {
    const resp = await client().messages.parse({
      model: MODEL,
      max_tokens: 3000,
      system: INGREDIENT_AGGREGATION_SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(AggregatedListSchema) },
      messages: [
        {
          role: "user",
          content: `Combine these recipes' ingredients into one shopping list. Scale each recipe from its default servings to the "servings" target before merging.\n\n${payload}`,
        },
      ],
    });
    if (!resp.parsed_output) throw new Error("Claude returned no parsed output");
    await recordUsage({
      userId,
      callType: "aggregate",
      success: true,
      inputSizeBytes: inputBytes,
      outputSizeBytes: JSON.stringify(resp.parsed_output).length,
      latencyMs: Date.now() - started,
    });
    return resp.parsed_output;
  } catch (e) {
    await recordUsage({
      userId,
      callType: "aggregate",
      success: false,
      inputSizeBytes: inputBytes,
      outputSizeBytes: 0,
      latencyMs: Date.now() - started,
    });
    throw e;
  }
}

export { ExtractionBudgetError } from "./rate-limit";
export type { ExtractedRecipe, SocialExtraction, AggregatedList, AggregatedIngredient } from "./schemas";
