import { readBodyCapped, safeFetch } from "@/lib/safe-fetch";
import { AH_API_BASE, AH_MAX_BODY_BYTES, AH_PATHS, AH_TIMEOUT_MS, ahHeaders } from "./constants";

// Thin HTTP layer for the Albert Heijn API. Nothing outside src/lib/ah
// touches URLs, headers or raw response shapes; the modules next to this
// one parse the JSON with Zod and hand out our own types.

/** Any non-2xx or malformed answer from AH. */
export class AhApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AhApiError";
  }
}

/** 401/403 or a session-expired code: the token is no good any more. */
export class AhAuthError extends AhApiError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, code);
    this.name = "AhAuthError";
  }
}

export type AhResponse = { status: number; json: unknown };

/**
 * Fetches `path` on the AH API. Resolves with the parsed JSON for 2xx and
 * throws AhAuthError / AhApiError otherwise. Never logs the body or the
 * token.
 */
export async function ahFetch(
  path: string,
  opts: { method?: "GET" | "POST" | "PATCH"; token?: string; body?: unknown; maxBytes?: number } = {}
): Promise<AhResponse> {
  const maxBytes = opts.maxBytes ?? AH_MAX_BODY_BYTES;
  let res: Response;
  try {
    res = await safeFetch(
      AH_API_BASE + path,
      {
        method: opts.method ?? "GET",
        headers: ahHeaders(opts.token),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(AH_TIMEOUT_MS),
      },
      { maxBytes, maxRedirects: 0 }
    );
  } catch (e) {
    throw new AhApiError(0, `Albert Heijn is unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  const raw = await readBodyCapped(res, maxBytes);
  const text = new TextDecoder().decode(raw);
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new AhApiError(res.status, `Albert Heijn sent something that is not JSON (HTTP ${res.status})`);
    }
  }

  if (res.status === 401 || res.status === 403 || errorCode(json) === "SESSION_EXPIRED") {
    throw new AhAuthError(res.status, "Albert Heijn rejected the login", errorCode(json));
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = errorDetail(json);
    throw new AhApiError(res.status, `Albert Heijn answered HTTP ${res.status}${detail ? `: ${detail}` : ""}`, errorCode(json));
  }
  return { status: res.status, json };
}

/** A short human message from an error body: `message`, or the first GraphQL error. */
function errorDetail(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const j = json as { message?: unknown; errors?: Array<{ message?: unknown }> };
  const m = typeof j.message === "string" ? j.message : j.errors?.[0]?.message;
  return typeof m === "string" ? m.slice(0, 200) : undefined;
}

function errorCode(json: unknown): string | undefined {
  if (json && typeof json === "object" && "code" in json && typeof (json as { code: unknown }).code === "string") {
    return (json as { code: string }).code;
  }
  return undefined;
}

/**
 * Runs a GraphQL operation. GraphQL answers 200 even when a field fails, so
 * the `errors` array is turned into an AhApiError (or AhAuthError when the
 * server says the caller is not signed in).
 */
export async function ahGraphql<T = unknown>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { json } = await ahFetch(AH_PATHS.graphql, {
    method: "POST",
    token,
    body: { query, variables },
  });
  const body = json as { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null;
  if (body?.errors?.length) {
    const first = body.errors[0];
    const code = first.extensions?.code;
    const msg = first.message ?? "GraphQL error";
    if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") throw new AhAuthError(401, msg, code);
    throw new AhApiError(200, msg, code);
  }
  if (!body || body.data === undefined) throw new AhApiError(200, "GraphQL answer had no data");
  return body.data;
}
