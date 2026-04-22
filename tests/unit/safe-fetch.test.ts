import { describe, it, expect } from "vitest";
import { safeFetch, SafeFetchError } from "@/lib/safe-fetch";

describe("safeFetch", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("data:text/plain,abc")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("gopher://example.com")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("rejects IP-literal URLs in private ranges", async () => {
    await expect(safeFetch("http://127.0.0.1/")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("http://10.0.0.1/")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      SafeFetchError
    );
    await expect(safeFetch("http://192.168.1.1/")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("http://172.16.0.1/")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("rejects localhost hostname explicitly", async () => {
    await expect(safeFetch("http://localhost/")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("http://foo.localhost/")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("http://metadata.google.internal/")).rejects.toBeInstanceOf(
      SafeFetchError
    );
  });

  it("rejects IPv6 loopback and link-local", async () => {
    await expect(safeFetch("http://[::1]/")).rejects.toBeInstanceOf(SafeFetchError);
    await expect(safeFetch("http://[fe80::1]/")).rejects.toBeInstanceOf(SafeFetchError);
  });

  it("rejects IPv4-mapped IPv6 pointing at a private IP", async () => {
    await expect(safeFetch("http://[::ffff:127.0.0.1]/")).rejects.toBeInstanceOf(SafeFetchError);
  });
});
