// Cheap pre-check before `req.formData()` / `req.json()` buffers the whole
// body: a client that announces a Content-Length over the limit is rejected
// without reading a byte. A missing (chunked) header passes — the per-route
// `file.size` / schema checks still apply afterwards.

export const MAX_JSON_BYTES = 1024 * 1024; // 1 MB
// multipart framing (boundaries, part headers) on top of the file itself
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function rejectIfTooLarge(req: Request, maxBytes: number): Response | null {
  const header = req.headers.get("content-length");
  if (header == null || header === "") return null;
  const length = Number(header);
  if (!Number.isFinite(length) || length <= maxBytes) return null;
  const maxMb = Math.round(maxBytes / (1024 * 1024));
  return Response.json({ error: `File too large (max ${maxMb} MB)` }, { status: 413 });
}
