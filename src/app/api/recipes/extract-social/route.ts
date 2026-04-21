import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  extractRecipeFromCaption,
} from "@/lib/claude";
import { detectSocialUrl } from "@/lib/social";

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

    // Collect what we can: title, author, caption text.
    let title: string | null = null;
    let author: string | null = null;
    let caption: string | null = null;

    if (detected.platform === "tiktok") {
      const meta = await fetchTikTokOEmbed(detected.normalizedUrl);
      title = meta?.title ?? null;
      author = meta?.author_name ?? null;
      // TikTok oEmbed doesn't include the full caption in "title" always — the
      // title IS the caption. Fall back to scraping if empty.
      caption = meta?.title ?? (await scrapeOgDescription(detected.normalizedUrl));
    } else {
      // Instagram oEmbed now requires a Meta App token; scrape the og:description
      // and og:title from the public post page instead.
      const { ogDescription, ogTitle } = await scrapeOg(detected.normalizedUrl);
      title = ogTitle;
      caption = ogDescription;
    }

    if (!caption) {
      return NextResponse.json(
        {
          found: false,
          reason: "Couldn't read the caption — try pasting the recipe text manually.",
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
      return NextResponse.json({ found: false, reason: result.reason ?? "No recipe in the caption." });
    }

    return NextResponse.json({
      found: true,
      recipe: {
        ...result.recipe,
        sourceUrl: detected.normalizedUrl,
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
): Promise<{ title?: string; author_name?: string } | null> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { title?: string; author_name?: string };
  } catch {
    return null;
  }
}

async function scrapeOg(url: string): Promise<{ ogTitle: string | null; ogDescription: string | null }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Liefdesnestje/1.0",
        Accept: "text/html",
      },
    });
    if (!res.ok) return { ogTitle: null, ogDescription: null };
    const html = await res.text();
    return {
      ogTitle: matchMeta(html, "og:title") ?? matchMeta(html, "twitter:title"),
      ogDescription: matchMeta(html, "og:description") ?? matchMeta(html, "twitter:description"),
    };
  } catch {
    return { ogTitle: null, ogDescription: null };
  }
}

async function scrapeOgDescription(url: string): Promise<string | null> {
  return (await scrapeOg(url)).ogDescription;
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
