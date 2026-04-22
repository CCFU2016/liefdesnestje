import { lookup } from "node:dns/promises";
import net from "node:net";

// SSRF defense: reject URLs that resolve to private/loopback/link-local IPs.
// Applies to every hop of a redirect chain.
//
// Limitations:
//  - DNS-lookup-then-fetch has a theoretical TOCTOU window (DNS answer
//    changes between check and connect). For full protection you'd need a
//    custom undici Dispatcher that also checks the post-connect peer IP.
//    For a household app's threat model, DNS-time check + HTTP(S)-only +
//    redirect re-check is a reasonable 90/10.
//  - IPv4-mapped IPv6 (::ffff:10.0.0.1) is normalized by net.isIPv4() so we
//    catch those too.

const BLOCKED_V4 = [
  /^0\./, // "this network"
  /^10\./, // RFC1918
  /^127\./, // loopback
  /^169\.254\./, // link-local (AWS metadata etc.)
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGN
  /^192\.0\.0\./, // IETF protocol assignments
  /^192\.0\.2\./, // TEST-NET-1
  /^198\.18\./, // benchmark
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^224\./, // multicast (224.0.0.0/4)
  /^2(2[4-9]|[34][0-9])\./, // multicast range
  /^2(4[0-9]|5[0-5])\./, // reserved / broadcast-ish
  /^255\.255\.255\.255$/,
];

const BLOCKED_V6 = [
  /^::1$/, // loopback
  /^::$/, // unspecified
  /^::ffff:/i, // IPv4-mapped — handled via isIP path too
  /^fe80/i, // link-local
  /^fc/i,
  /^fd/i, // unique local
  /^ff/i, // multicast
];

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

function assertPublicIp(ip: string) {
  const v = net.isIP(ip);
  if (v === 4) {
    for (const re of BLOCKED_V4) if (re.test(ip)) throw new SafeFetchError(`Blocked private/reserved IP: ${ip}`);
  } else if (v === 6) {
    const lower = ip.toLowerCase();
    // Unwrap IPv4-mapped "::ffff:10.0.0.1" and re-check
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      if (net.isIPv4(v4)) return assertPublicIp(v4);
    }
    for (const re of BLOCKED_V6) if (re.test(lower)) throw new SafeFetchError(`Blocked private/reserved IPv6: ${ip}`);
  } else {
    throw new SafeFetchError(`Not a valid IP: ${ip}`);
  }
}

async function assertSafeHost(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError(`Only http/https allowed, got ${url.protocol}`);
  }
  const host = url.hostname;
  if (net.isIP(host)) {
    assertPublicIp(host);
    return;
  }
  // Block bare "localhost" and friends even if DNS hands back something public
  // somewhere downstream.
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower === "metadata.google.internal" ||
    lower === "metadata"
  ) {
    throw new SafeFetchError(`Blocked host: ${host}`);
  }
  // DNS lookup, reject if any returned address is private
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch (e) {
    throw new SafeFetchError(`DNS lookup failed for ${host}: ${(e as Error).message}`);
  }
  if (addrs.length === 0) throw new SafeFetchError(`No addresses for ${host}`);
  for (const a of addrs) assertPublicIp(a.address);
}

/**
 * SSRF-safe wrapper around fetch. Blocks private/loopback/link-local IPs,
 * non-http(s) schemes, and re-checks on every redirect hop.
 */
export async function safeFetch(
  url: string | URL,
  init: RequestInit = {},
  options: { maxRedirects?: number } = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = typeof url === "string" ? url : url.toString();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = new URL(current);
    await assertSafeHost(u);

    const res = await fetch(u, { ...init, redirect: "manual" });

    // 3xx with Location → follow ourselves, re-checking host
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      if (hop === maxRedirects) {
        throw new SafeFetchError(`Too many redirects (>${maxRedirects})`);
      }
      current = new URL(res.headers.get("location")!, u).toString();
      // Drain the response body so fetch frees the socket
      await res.arrayBuffer().catch(() => undefined);
      continue;
    }
    return res;
  }
  throw new SafeFetchError("Unreachable redirect loop");
}
