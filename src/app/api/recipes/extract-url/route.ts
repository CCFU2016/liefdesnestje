import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  extractRecipeFromText,
} from "@/lib/claude";
import { downloadAndSaveImage } from "@/lib/uploads";
import { safeFetch, SafeFetchError } from "@/lib/safe-fetch";

export const maxDuration = 60;

const bodySchema = z.union([
  z.object({ url: z.string().url() }),
  z.object({ rawText: z.string().min(20).max(20000) }), // fallback path — user pasted text
]);

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    // Raw text fallback — skip fetch, go straight to Claude.
    if ("rawText" in parsed.data) {
      const recipe = await extractRecipeFromText(parsed.data.rawText, ctx.userId);
      return NextResponse.json({ recipe });
    }

    // URL path.
    const url = parsed.data.url;
    const html = await fetchBoundedHtml(url);
    if (!html) {
      return NextResponse.json(
        { error: "Couldn't fetch that URL — it might be private, blocked, or down." },
        { status: 400 }
      );
    }

    // Persist the best image we can find locally so the recipe card always
    // has something to show (og:image hosts sometimes go away).
    const ogImage = extractOgImage(html);
    const localImageUrl = ogImage ? await downloadAndSaveImage(ogImage) : null;

    // 1. Prefer JSON-LD Recipe schema if present — structured, more reliable.
    const jsonLd = parseJsonLdRecipe(html);
    if (jsonLd) {
      const jsonLdImage = (jsonLd.imageUrl as string | undefined) ?? null;
      const imageUrl =
        localImageUrl ?? (jsonLdImage ? await downloadAndSaveImage(jsonLdImage) : null);
      return NextResponse.json({
        recipe: {
          ...jsonLd,
          sourceUrl: url,
          imageUrl,
        },
      });
    }

    // 2. Strip HTML to plain text, send to Claude.
    const text = htmlToText(html);
    const trimmed = text.slice(0, 40000); // cap input
    const recipe = await extractRecipeFromText(trimmed, ctx.userId);
    return NextResponse.json({
      recipe: {
        ...recipe,
        sourceUrl: url,
        imageUrl: localImageUrl,
      },
    });
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
    console.error("extract-url failed", e);
    return NextResponse.json(
      { error: "Couldn't read that recipe — try pasting the text manually." },
      { status: 500 }
    );
  }
}

async function fetchBoundedHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await safeFetch(
      url,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Liefdesnestje/1.0; +https://github.com/CCFU2016/liefdesnestje)",
          Accept: "text/html,application/xhtml+xml",
        },
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    // Bound the response size.
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        if (received > MAX_HTML_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return buf.toString("utf8");
  } catch (e) {
    if (e instanceof SafeFetchError) {
      console.warn("fetchBoundedHtml blocked by safeFetch:", e.message);
    }
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOgImage(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m?.[1] ?? null;
}

/**
 * Parse JSON-LD for a Recipe schema. Handles @graph arrays, arrays of types,
 * and nested objects. Returns a normalized ExtractedRecipe-shaped object or null.
 */
function parseJsonLdRecipe(html: string): Record<string, unknown> | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of scripts) {
    try {
      const json = JSON.parse(raw.trim());
      const candidates = flattenCandidates(json);
      for (const c of candidates) {
        if (isRecipe(c)) return normalizeJsonLdRecipe(c);
      }
    } catch {
      // invalid JSON-LD blocks are common; skip
    }
  }
  return null;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function flattenCandidates(j: JsonValue): Array<Record<string, JsonValue>> {
  if (!j || typeof j !== "object") return [];
  if (Array.isArray(j)) return j.flatMap(flattenCandidates);
  const obj = j as Record<string, JsonValue>;
  const out: Array<Record<string, JsonValue>> = [obj];
  if ("@graph" in obj) out.push(...flattenCandidates(obj["@graph"]));
  return out;
}

function isRecipe(obj: Record<string, JsonValue>): boolean {
  const t = obj["@type"];
  if (typeof t === "string") return t.toLowerCase() === "recipe";
  if (Array.isArray(t)) return t.some((x) => typeof x === "string" && x.toLowerCase() === "recipe");
  return false;
}

function normalizeJsonLdRecipe(r: Record<string, JsonValue>): Record<string, unknown> {
  const title = asString(r.name) ?? "Untitled recipe";
  const description = asString(r.description);
  const servings = parseYield(r.recipeYield) ?? 2;
  const prepTimeMinutes = parseDuration(r.prepTime);
  const cookTimeMinutes = parseDuration(r.cookTime);
  const ingredients = asArray(r.recipeIngredient).map((i): Record<string, unknown> => ({
    quantity: null,
    unit: null,
    name: typeof i === "string" ? i : String(i),
    notes: null,
  }));
  const instructions = parseInstructions(r.recipeInstructions);
  const tags = parseTags(r.keywords, r.recipeCategory, r.recipeCuisine);
  const imageUrl = asImageUrl(r.image);

  return {
    title,
    description,
    servings,
    prepTimeMinutes,
    cookTimeMinutes,
    ingredients,
    instructions,
    tags,
    nutritionPerServing: null,
    imageUrl,
  };
}

function asString(v: JsonValue | undefined): string | null {
  return typeof v === "string" ? v.trim() : null;
}

function asArray(v: JsonValue | undefined): JsonValue[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function parseYield(v: JsonValue | undefined): number | null {
  if (typeof v === "number") return Math.floor(v);
  if (typeof v === "string") {
    const m = v.match(/\d+/);
    if (m) return parseInt(m[0], 10);
  }
  if (Array.isArray(v)) for (const x of v) {
    const n = parseYield(x);
    if (n) return n;
  }
  return null;
}

function parseDuration(v: JsonValue | undefined): number | null {
  if (typeof v !== "string") return null;
  // ISO 8601 duration: "PT15M", "PT1H30M"
  const m = v.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const total = h * 60 + mm;
  return total > 0 ? total : null;
}

function parseInstructions(v: JsonValue | undefined): string[] {
  if (!v) return [];
  if (typeof v === "string") {
    // single-string instruction — split by line
    return v.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }
  const arr = asArray(v);
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === "string") out.push(item.trim());
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, JsonValue>;
      const type = asString(obj["@type"]);
      if (type === "HowToSection") {
        const nested = parseInstructions(obj.itemListElement);
        out.push(...nested);
      } else {
        const text = asString(obj.text) ?? asString(obj.name);
        if (text) out.push(text);
      }
    }
  }
  return out;
}

function parseTags(...vals: (JsonValue | undefined)[]): string[] {
  const out = new Set<string>();
  for (const v of vals) {
    if (typeof v === "string") {
      v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((t) => out.add(t));
    } else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string") out.add(x.trim().toLowerCase());
    }
  }
  return Array.from(out).slice(0, 10);
}

function asImageUrl(v: JsonValue | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, JsonValue>;
    return asString(obj.url) ?? null;
  }
  return null;
}
