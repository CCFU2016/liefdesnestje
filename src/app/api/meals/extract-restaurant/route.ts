import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";
import {
  ClaudeNotConfiguredError,
  ExtractionBudgetError,
  extractRestaurantFromText,
} from "@/lib/claude";
import { safeFetch, SafeFetchError } from "@/lib/safe-fetch";

export const maxDuration = 60;

const bodySchema = z.object({ url: z.string().url() });

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(req: Request) {
  try {
    const ctx = await requireHouseholdMember();
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const url = parsed.data.url;
    const html = await fetchBoundedHtml(url);
    if (!html) {
      return NextResponse.json(
        { error: "Couldn't fetch that URL — it might be private, blocked, or down." },
        { status: 400 }
      );
    }

    // Small but useful pre-pass: expose existing <a> menu links inline so
    // Claude doesn't have to infer them purely from anchor text.
    const text = htmlToText(html).slice(0, 25_000);

    const restaurant = await extractRestaurantFromText({
      text,
      sourceUrl: url,
      userId: ctx.userId,
    });

    // Final sanity: convert relative menu URLs Claude may have missed to absolute.
    let menuUrl = restaurant.menuUrl;
    if (menuUrl && !/^https?:\/\//i.test(menuUrl)) {
      try {
        menuUrl = new URL(menuUrl, url).toString();
      } catch {
        menuUrl = null;
      }
    }

    return NextResponse.json({
      name: restaurant.name,
      address: restaurant.address,
      menuUrl,
      sourceUrl: url,
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
    console.error("extract-restaurant failed", e);
    return NextResponse.json(
      { error: "Couldn't read that restaurant site — try filling in the fields manually." },
      { status: 500 }
    );
  }
}

async function fetchBoundedHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await safeFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Liefdesnestje/1.0; +https://github.com/CCFU2016/liefdesnestje)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
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
      console.warn("extract-restaurant blocked by safeFetch:", e.message);
    }
    return null;
  }
}

// Keep anchor `href` attributes visible to Claude so it can pick the menu
// link out of the text pass. We preserve link text + href inline as
// "text (href)" before stripping the rest of the tags.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => {
      const t = String(txt).replace(/<[^>]+>/g, " ").trim();
      return t ? `${t} (${href})` : `(${href})`;
    })
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
