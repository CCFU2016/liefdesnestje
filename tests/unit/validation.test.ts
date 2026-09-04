import { describe, it, expect } from "vitest";
import { httpOrAppUrl, httpUrl } from "@/lib/validation";

describe("httpUrl", () => {
  it("accepts http and https", () => {
    expect(httpUrl.safeParse("https://example.com/menu.pdf?x=1").success).toBe(true);
    expect(httpUrl.safeParse("HTTP://example.com").success).toBe(true);
  });

  it("rejects other schemes and non-URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/plain,hi",
      "ftp://example.com",
      "example.com",
      "/api/uploads/recipes/a.jpg",
      "https://exa mple.com",
      "",
    ]) {
      expect(httpUrl.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("caps length at 2000", () => {
    expect(httpUrl.safeParse("https://e.com/" + "a".repeat(1980)).success).toBe(true);
    expect(httpUrl.safeParse("https://e.com/" + "a".repeat(2000)).success).toBe(false);
  });
});

describe("httpOrAppUrl", () => {
  it("additionally accepts app-relative /api/ paths", () => {
    expect(httpOrAppUrl.safeParse("/api/holidays/abc/travel/document?path=travel%2Fx.pdf").success).toBe(true);
    expect(httpOrAppUrl.safeParse("https://example.com/x").success).toBe(true);
  });

  it("still rejects other relative paths and schemes", () => {
    expect(httpOrAppUrl.safeParse("/etc/passwd").success).toBe(false);
    expect(httpOrAppUrl.safeParse("api/x").success).toBe(false);
    expect(httpOrAppUrl.safeParse("javascript:alert(1)").success).toBe(false);
  });
});
