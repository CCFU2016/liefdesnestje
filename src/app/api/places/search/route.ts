import { NextResponse } from "next/server";
import { safeFetch } from "@/lib/safe-fetch";
import { requireHouseholdMember, UnauthorizedError } from "@/lib/auth/household";

// City-level autocomplete via Photon (photon.komoot.io) — an OSM-based
// geocoder explicitly built for search-as-you-type (Nominatim's usage policy
// forbids autocomplete against their public API). Server-side proxy so the
// browser never talks to a third party. osm_tag filters keep results at
// settlement level: cities, towns, villages.

type PhotonFeature = {
  geometry: { coordinates: [number, number] }; // lon, lat
  properties: {
    osm_id: number;
    name?: string;
    country?: string;
    countrycode?: string; // ISO 3166-1 alpha-2, uppercase
    state?: string;
    osm_key?: string;
    osm_value?: string;
  };
};

export async function GET(req: Request) {
  try {
    await requireHouseholdMember();
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ results: [] });

    const params = new URLSearchParams({ q, limit: "6", lang: "en" });
    for (const tag of ["place:city", "place:town", "place:village", "place:municipality"]) {
      params.append("osm_tag", tag);
    }
    const res = await safeFetch(`https://photon.komoot.io/api/?${params}`, {
      headers: {
        "User-Agent":
          "Liefdesnestje/1.0 (household dashboard; https://github.com/CCFU2016/liefdesnestje)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ results: [] });

    const data = (await res.json()) as { features?: PhotonFeature[] };
    const results = (data.features ?? [])
      .filter((f) => f.properties.name && f.geometry?.coordinates)
      .map((f) => {
        const p = f.properties;
        const displayName = [p.name, p.state, p.country].filter(Boolean).join(", ");
        return {
          id: p.osm_id,
          name: p.name!,
          displayName,
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
          country: p.country ?? null,
          countryCode: p.countrycode?.toLowerCase() ?? null,
          state: p.state ?? null,
        };
      });
    return NextResponse.json({ results });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json({ results: [] });
  }
}
