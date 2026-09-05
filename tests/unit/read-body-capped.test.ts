import { describe, it, expect } from "vitest";
import { BodyTooLargeError, readBodyCapped, SafeFetchError } from "@/lib/safe-fetch";

function streamOf(chunks: Uint8Array[], onCancel?: () => void): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(body);
}

describe("readBodyCapped", () => {
  it("concatenates chunks under the cap", async () => {
    const res = streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]);
    expect(Array.from(await readBodyCapped(res, 10))).toEqual([1, 2, 3]);
  });

  it("accepts a body exactly at the cap", async () => {
    const res = streamOf([new Uint8Array([1, 2]), new Uint8Array([3, 4])]);
    expect((await readBodyCapped(res, 4)).length).toBe(4);
  });

  it("cancels the stream and throws once the cap is exceeded", async () => {
    let cancelled = false;
    const res = streamOf(
      [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)],
      () => (cancelled = true)
    );
    const err = await readBodyCapped(res, 5).catch((e) => e);
    expect(err).toBeInstanceOf(BodyTooLargeError);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(cancelled).toBe(true);
  });

  it("returns an empty array for a body-less response", async () => {
    expect((await readBodyCapped(new Response(null), 10)).length).toBe(0);
  });
});
