import "server-only";
import exifr from "exifr";
import { safeFetch } from "@/lib/safe-fetch";

// Pull GPS coords out of the downloaded image bytes (if Apple didn't strip
// them) and optionally reverse-geocode into a human-readable place name.
// Everything here is best-effort — failures return null so the caller can
// gracefully omit location from the card.

export async function extractGps(
  bytes: Uint8Array
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const parsed = await exifr.parse(bytes as unknown as Buffer, { gps: true });
    if (!parsed) return null;
    const lat = (parsed as { latitude?: number }).latitude;
    const lng = (parsed as { longitude?: number }).longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { latitude: lat, longitude: lng };
  } catch {
    return null;
  }
}

// Nominatim is OpenStreetMap's free reverse-geocoding service. Fair-use
// policy: max 1 request/sec, must set a descriptive User-Agent, and cache
// results. We fire once per household per day so the rate is irrelevant;
// our user-agent points back at the app so admins can identify traffic.
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=14&accept-language=en`;
    const res = await safeFetch(url, {
      headers: {
        "User-Agent": "Liefdesnestje/1.0 (household dashboard; https://github.com/CCFU2016/liefdesnestje)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
        suburb?: string;
        county?: string;
        state?: string;
        country?: string;
        country_code?: string;
      };
      display_name?: string;
    };
    const addr = data.address ?? {};
    const locality =
      addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.suburb ?? addr.county;
    const region = addr.state;
    const country = addr.country;
    const parts = [locality, country && locality !== country ? country : region]
      .filter((p): p is string => !!p && p.trim().length > 0);
    if (parts.length > 0) return parts.join(", ");
    return data.display_name ?? null;
  } catch {
    return null;
  }
}
