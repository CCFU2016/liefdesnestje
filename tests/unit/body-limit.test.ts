import { describe, it, expect } from "vitest";
import { MAX_JSON_BYTES, rejectIfTooLarge } from "@/lib/http/body-limit";

function reqWith(contentLength?: string): Request {
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Request("http://localhost/api/x", { method: "POST", headers });
}

describe("rejectIfTooLarge", () => {
  it("passes when Content-Length is missing", () => {
    expect(rejectIfTooLarge(reqWith(), 1024)).toBeNull();
  });

  it("passes at or under the limit", () => {
    expect(rejectIfTooLarge(reqWith("1024"), 1024)).toBeNull();
    expect(rejectIfTooLarge(reqWith("0"), 1024)).toBeNull();
  });

  it("returns 413 JSON over the limit, with the cap in whole MB", async () => {
    const res = rejectIfTooLarge(reqWith(String(MAX_JSON_BYTES + 1)), MAX_JSON_BYTES);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(413);
    expect(await res!.json()).toEqual({ error: "File too large (max 1 MB)" });
  });

  it("rounds a limit that includes multipart overhead back to the file cap", async () => {
    const tenMb = 10 * 1024 * 1024;
    const res = rejectIfTooLarge(reqWith(String(tenMb * 2)), tenMb + 64 * 1024);
    expect(await res!.json()).toEqual({ error: "File too large (max 10 MB)" });
  });

  it("passes an unparseable Content-Length through to the body parser", () => {
    expect(rejectIfTooLarge(reqWith("abc"), 1024)).toBeNull();
  });
});
