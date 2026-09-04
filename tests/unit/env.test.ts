import { describe, expect, it } from "vitest";
import { validateEnv } from "@/lib/env";

const good = {
  DATABASE_URL: "postgres://x",
  AUTH_SECRET: "a".repeat(44),
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "s",
  ENCRYPTION_KEY: "ab".repeat(32),
  WEBHOOK_SECRET: "w".repeat(24),
};

describe("validateEnv", () => {
  it("passes a complete configuration, warning about optional features", () => {
    const r = validateEnv(good);
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith("ANTHROPIC_API_KEY"))).toBe(true);
  });
  it("lists every missing required variable", () => {
    const r = validateEnv({ DATABASE_URL: "x" });
    expect(r.missing).toEqual(["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "ENCRYPTION_KEY", "WEBHOOK_SECRET"]);
  });
  it("rejects a malformed encryption key", () => {
    const r = validateEnv({ ...good, ENCRYPTION_KEY: "not-hex" });
    expect(r.invalid[0]).toMatch(/ENCRYPTION_KEY/);
  });
});
