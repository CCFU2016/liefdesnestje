import { describe, expect, it } from "vitest";
import { isSignInAllowed, parseAllowlist, normaliseEmail } from "@/lib/auth/allowlist";

const allow = parseAllowlist("Niki@Example.com, laura@example.com\npartner@example.org");

describe("parseAllowlist", () => {
  it("splits on commas, whitespace and semicolons and lower-cases", () => {
    expect([...allow]).toEqual(["niki@example.com", "laura@example.com", "partner@example.org"]);
  });
  it("is empty when unset", () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist("").size).toBe(0);
  });
});

describe("normaliseEmail", () => {
  it("trims and lower-cases, rejects junk", () => {
    expect(normaliseEmail("  A@B.com ")).toBe("a@b.com");
    expect(normaliseEmail("nope")).toBeNull();
    expect(normaliseEmail(null)).toBeNull();
  });
});

describe("isSignInAllowed", () => {
  it("always lets an existing account in, even if the allowlist changed", () => {
    expect(
      isSignInAllowed({ email: "old@member.com", allowlist: allow, userExists: true, anyUsers: true })
    ).toBe(true);
  });
  it("lets an allowlisted new account in (case-insensitive)", () => {
    expect(
      isSignInAllowed({ email: "LAURA@example.com", allowlist: allow, userExists: false, anyUsers: true })
    ).toBe(true);
  });
  it("denies a stranger once anyone has signed up", () => {
    expect(
      isSignInAllowed({ email: "stranger@gmail.com", allowlist: allow, userExists: false, anyUsers: true })
    ).toBe(false);
  });
  it("denies a stranger with an empty allowlist too", () => {
    expect(
      isSignInAllowed({ email: "stranger@gmail.com", allowlist: new Set(), userExists: false, anyUsers: true })
    ).toBe(false);
  });
  it("allows the very first sign-in on an empty database", () => {
    expect(
      isSignInAllowed({ email: "first@person.com", allowlist: new Set(), userExists: false, anyUsers: false })
    ).toBe(true);
  });
  it("denies when the provider returns no email", () => {
    expect(isSignInAllowed({ email: null, allowlist: allow, userExists: false, anyUsers: false })).toBe(false);
  });
});
