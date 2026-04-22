import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  extractRecipeFromCaption,
} from "@/lib/claude";
import { detectSocialUrl } from "@/lib/social";
import { downloadAndSaveImage } from "@/lib/uploads";
import { safeFetch, SafeFetchError } from "@/lib/safe-fetch";

export const maxDuration = 60;

const bodySchema = z.object({ url: z.string().url() });

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const detected = detectSocialUrl(parsed.data.url);
    if (!detected) {
      return NextResponse.json(
        { error: "That URL doesn't look like a TikTok or Instagram link." },
        { status: 400 }
      );
    }

    // Collect what we can: title, author, caption text, thumbnail.
    let title: string | null = null;
    let author: string | null = null;
    let caption: string | null = null;
    let thumbnailUrl: string | null = null;

    if (detected.platform === "tiktok") {
      const meta = await fetchTikTokOEmbed(detected.normalizedUrl);
      title = meta?.title ?? null;
      author = meta?.author_name ?? null;
      thumbnailUrl = meta?.thumbnail_url ?? null;
      // TikTok oEmbed doesn't include the full caption in "title" always — the
      // title IS the caption. Fall back to scraping if empty.
      caption = meta?.title ?? null;
      if (!caption || !thumbnailUrl) {
        const og = await scrapeOg(detected.normalizedUrl);
        caption = caption ?? og.ogDescription;
        thumbnailUrl = thumbnailUrl ?? og.ogImage;
      }
    } else {
      // Instagram oEmbed requires a Meta App token; scrape the og tags from the
      // public post page instead.
      const og = await scrapeOg(detected.normalizedUrl);
      title = og.ogTitle;
      caption = og.ogDescription;
      thumbnailUrl = og.ogImage;
    }

    // Download + persist the thumbnail locally — CDN URLs on TikTok/IG are
    // signed and expire within hours. Store a local copy so the recipe card
    // keeps its image forever.
    const localImageUrl = thumbnailUrl ? await downloadAndSaveImage(thumbnailUrl) : null;

    if (!caption) {
      return NextResponse.json(
        {
          found: false,
          reason: "Couldn't read the caption — try pasting the recipe text manually.",
          imageUrl: localImageUrl, // still surface the thumbnail; user might still fill in manually
        },
        { status: 200 }
      );
    }

    const result = await extractRecipeFromCaption(caption, ctx.userId, {
      platform: detected.platform,
      author: author ?? undefined,
      title: title ?? undefined,
    });

    if (!result.found || !result.recipe) {
      return NextResponse.json({
        found: false,
        reason: result.reason ?? "No recipe in the caption.",
        imageUrl: localImageUrl,
      });
    }

    return NextResponse.json({
      found: true,
      recipe: {
        ...result.recipe,
        sourceUrl: detected.normalizedUrl,
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
    console.error("extract-social failed", e);
    return NextResponse.json(
      { error: "Couldn't read that post — try pasting the recipe text manually." },
      { status: 500 }
    );
  }
}

async function fetchTikTokOEmbed(
  url: string
): Promise<{ title?: string; author_name?: string; thumbnail_url?: string } | null> {
  try {
    const res = await safeFetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
  } catch (e) {
    if (e instanceof SafeFetchError) {
      console.warn("fetchTikTokOEmbed blocked by safeFetch:", e.message);
    }
    return null;
  }
}

async function scrapeOg(
  url: string
): Promise<{ ogTitle: string | null; ogDescription: string | null; ogImage: string | null }> {
  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Liefdesnestje/1.0",
        Accept: "text/html",
      },
    });
    if (!res.ok) return { ogTitle: null, ogDescription: null, ogImage: null };
    const html = await res.text();
    return {
      ogTitle: matchMeta(html, "og:title") ?? matchMeta(html, "twitter:title"),
      ogDescription: matchMeta(html, "og:description") ?? matchMeta(html, "twitter:description"),
      ogImage: matchMeta(html, "og:image") ?? matchMeta(html, "twitter:image"),
    };
  } catch (e) {
    if (e instanceof SafeFetchError) {
      console.warn("scrapeOg blocked by safeFetch:", e.message);
    }
    return { ogTitle: null, ogDescription: null, ogImage: null };
  }
}

function matchMeta(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(/:/g, "\\:")}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const m = html.match(re);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
