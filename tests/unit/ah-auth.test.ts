import { describe, expect, it } from "vitest";
import { extractAuthCode, shouldRefresh } from "@/lib/ah/auth";
import { AH_CLIENT_ID, AH_LOGIN_URL, ahHeaders } from "@/lib/ah/constants";

describe("extractAuthCode", () => {
  const code = "a968bb4d-838c-4657-9404-e9165d23da23";
  it("takes the code out of the appie:// link", () => {
    expect(extractAuthCode(`appie://login-exit?code=${code}`)).toBe(code);
    expect(extractAuthCode(`  appie://login-exit?code=${code}&state=x \n`)).toBe(code);
  });
  it("takes it out of the Chrome console line too", () => {
    expect(
      extractAuthCode(`Failed to launch 'appie://login-exit?code=${code}' because the scheme does not have a registered handler.`)
    ).toBe(code);
  });
  it("accepts a bare code", () => {
    expect(extractAuthCode(code)).toBe(code);
  });
  it("rejects junk, empty input and a link without a code", () => {
    expect(extractAuthCode("")).toBeNull();
    expect(extractAuthCode("hello world")).toBeNull();
    expect(extractAuthCode("appie://login-exit")).toBeNull();
    expect(extractAuthCode("x".repeat(5000))).toBeNull();
  });
});

describe("shouldRefresh", () => {
  const now = new Date("2026-09-11T10:00:00Z");
  it("is false with plenty of time left", () => {
    expect(shouldRefresh(new Date("2026-09-11T12:00:00Z"), now)).toBe(false);
  });
  it("is true inside the five-minute skew and after expiry", () => {
    expect(shouldRefresh(new Date("2026-09-11T10:04:00Z"), now)).toBe(true);
    expect(shouldRefresh(new Date("2026-09-11T09:00:00Z"), now)).toBe(true);
  });
  it("honours a custom skew", () => {
    expect(shouldRefresh(new Date("2026-09-11T10:30:00Z"), now, 60 * 60 * 1000)).toBe(true);
  });
});

describe("ahHeaders", () => {
  it("identifies as the AH app and only adds Authorization with a token", () => {
    const anon = ahHeaders();
    expect(anon["x-client-name"]).toBe(AH_CLIENT_ID);
    expect(anon["x-application"]).toBe("AHWEBSHOP");
    expect(anon["User-Agent"]).toMatch(/^Appie\//);
    expect(anon.Authorization).toBeUndefined();
    expect(ahHeaders("tok").Authorization).toBe("Bearer tok");
  });
  it("uses the same client id in the login URL as in the exchange", () => {
    expect(AH_LOGIN_URL).toContain(`client_id=${AH_CLIENT_ID}`);
    expect(AH_LOGIN_URL).toContain("redirect_uri=appie://login-exit");
  });
});
