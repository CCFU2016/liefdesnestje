import { describe, it, expect } from "vitest";
import { sniffMime } from "@/lib/file-magic";

function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("sniffMime", () => {
  it("detects JPEG", () => {
    // JPEG SOI + APP0 + padding to 12 bytes
    expect(sniffMime(bytes("FF D8 FF E0 00 10 4A 46 49 46 00 01"))).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    expect(sniffMime(bytes("89 50 4E 47 0D 0A 1A 0A 00 00 00 0D"))).toBe("image/png");
  });

  it("detects GIF87a and GIF89a", () => {
    expect(sniffMime(bytes("47 49 46 38 37 61 01 00 01 00 00 00"))).toBe("image/gif");
    expect(sniffMime(bytes("47 49 46 38 39 61 01 00 01 00 00 00"))).toBe("image/gif");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    expect(sniffMime(bytes("52 49 46 46 00 00 00 00 57 45 42 50"))).toBe("image/webp");
  });

  it("detects PDF", () => {
    expect(sniffMime(bytes("25 50 44 46 2D 31 2E 34 0A 00 00 00"))).toBe("application/pdf");
  });

  it("rejects an unknown blob (e.g. HTML masquerading as JPEG)", () => {
    // "<html" bytes
    expect(sniffMime(bytes("3C 68 74 6D 6C 3E 00 00 00 00 00 00"))).toBeNull();
  });

  it("rejects too-short buffers (unless PDF)", () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffMime(bytes("25 50 44 46 2D"))).toBe("application/pdf");
  });
});
