import { describe, it, expect } from "vitest";
import { detectSocialUrl } from "@/lib/social";

describe("detectSocialUrl", () => {
  it("matches tiktok video URLs", () => {
    expect(
      detectSocialUrl("https://www.tiktok.com/@chefmario/video/1234567890")
    ).toMatchObject({ platform: "tiktok" });
  });

  it("matches tiktok short links", () => {
    expect(detectSocialUrl("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ platform: "tiktok" });
  });

  it("matches instagram reel URLs", () => {
    expect(detectSocialUrl("https://www.instagram.com/reel/ABC123xyz/")).toMatchObject({
      platform: "instagram",
    });
  });

  it("matches instagram post URLs on the /p/ path", () => {
    expect(detectSocialUrl("https://www.instagram.com/p/ABC/")).toMatchObject({
      platform: "instagram",
    });
  });

  it("rejects instagram profile URLs", () => {
    expect(detectSocialUrl("https://www.instagram.com/chefmario/")).toBeNull();
  });

  it("rejects unrelated domains", () => {
    expect(detectSocialUrl("https://www.youtube.com/watch?v=abc")).toBeNull();
    expect(detectSocialUrl("https://example.com/recipe")).toBeNull();
  });

  it("rejects non-URL strings", () => {
    expect(detectSocialUrl("not a url")).toBeNull();
    expect(detectSocialUrl("")).toBeNull();
  });

  it("normalizes mixed-case hostnames", () => {
    expect(detectSocialUrl("https://WWW.TikTok.com/@chefmario/video/1234")).toMatchObject({
      platform: "tiktok",
    });
  });
});
