import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

describe("encryption", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  });

  it("round-trips a string", async () => {
    const { encrypt, decrypt } = await import("@/lib/auth/encryption");
    const plain = "ms-refresh-token-abc123.very-long-very-secret";
    const enc = encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(decrypt(enc)).toBe(plain);
  });

  it("produces distinct ciphertexts per call (random IV)", async () => {
    const { encrypt } = await import("@/lib/auth/encryption");
    const a = encrypt("same-input");
    const b = encrypt("same-input");
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/auth/encryption");
    const enc = encrypt("secret");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0x01; // flip one bit of the ciphertext
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });
});
