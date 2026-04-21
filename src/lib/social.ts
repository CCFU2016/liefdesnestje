export type SocialPlatform = "tiktok" | "instagram";

export type SocialUrlInfo = {
  platform: SocialPlatform;
  normalizedUrl: string;
};

/**
 * Detect which social platform a URL belongs to and normalize it.
 * Returns null for unsupported URLs.
 */
export function detectSocialUrl(raw: string): SocialUrlInfo | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    // Accept:
    //   https://www.tiktok.com/@user/video/1234567890
    //   https://vm.tiktok.com/ZMabc123/
    //   https://m.tiktok.com/...
    return { platform: "tiktok", normalizedUrl: url.toString() };
  }

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    // Accept /reel/, /reels/, /p/
    if (/\/(reel|reels|p)\//.test(url.pathname)) {
      return { platform: "instagram", normalizedUrl: url.toString() };
    }
  }

  return null;
}
