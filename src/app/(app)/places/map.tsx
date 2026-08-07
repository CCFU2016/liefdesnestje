"use client";

// The actual Leaflet map. Loaded with next/dynamic({ ssr: false }) from the
// page client — Leaflet touches `window` at import time and cannot render on
// the server.

import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON } from "react-leaflet";
import { divIcon, type PathOptions } from "leaflet";
import "leaflet/dist/leaflet.css";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection } from "geojson";
import countriesTopo from "world-atlas/countries-110m.json";
import statesTopo from "us-atlas/states-10m.json";
import ccn3ToCca2 from "./ccn3-to-cca2.json";
import {
  flagOf,
  formatVisited,
  memberMapColor,
  pinColor,
  whoLabel,
  TOGETHER_COLOR,
  type Member,
  type Place,
} from "./types";

// world-atlas ships TopoJSON with ISO 3166-1 *numeric* feature ids; our
// places store Nominatim's *alpha-2* codes. Convert once at module load.
const numericToAlpha2 = ccn3ToCca2 as Record<string, string>;

// Fiji, Russia, and Antarctica cross the ±180° antimeridian; drawn naively
// their borders jump across the whole world as horizontal lines. Shift the
// negative-longitude half of any crossing ring +360° so the polygon renders
// continuously (worldCopyJump paints the wrapped copy on the other side).
function unwrapAntimeridian(fc: FeatureCollection): FeatureCollection {
  for (const f of fc.features) {
    const polys =
      f.geometry?.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry?.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];
    for (const poly of polys) {
      for (const ring of poly) {
        const crosses = ring.some(
          (pt, i) => i > 0 && Math.abs(pt[0] - ring[i - 1][0]) > 180
        );
        if (crosses) {
          for (const pt of ring) if (pt[0] < 0) pt[0] += 360;
        }
      }
    }
  }
  return fc;
}

const countryFeatures = unwrapAntimeridian(
  feature(
    countriesTopo as unknown as Topology,
    (countriesTopo as unknown as { objects: { countries: GeometryCollection } }).objects.countries
  ) as unknown as FeatureCollection
  // Antarctica's ring encircles the pole — no unwrap can fix its seam, and
  // its stroke drew a line across the bottom of the map. Leave it off the
  // boundary layer (pins there would still render fine).
).features.filter((f) => String(f.id).padStart(3, "0") !== "010");

// US states as their own layer — the USA gets filled state-by-state, not as
// one giant country blob.
const stateFeatures = (
  feature(
    statesTopo as unknown as Topology,
    (statesTopo as unknown as { objects: { states: GeometryCollection } }).objects.states
  ) as unknown as FeatureCollection
).features;

function stateNameOf(f: Feature): string | null {
  return ((f.properties as { name?: string } | null)?.name ?? null);
}

function alpha2Of(f: Feature): string | null {
  const id = String(f.id ?? "").padStart(3, "0");
  return numericToAlpha2[id] ?? null;
}

// Teardrop pin as inline SVG so we can color it per member without shipping
// image assets (Leaflet's default marker PNGs don't survive bundling well).
function pinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 23 13 23s13-13.3 13-23C26 5.8 20.2 0 13 0z" fill="${color}"/>
    <circle cx="13" cy="13" r="5.5" fill="white"/>
  </svg>`;
  return divIcon({
    html: svg,
    className: "", // no default leaflet styles
    iconSize: [26, 36],
    iconAnchor: [13, 36],
    popupAnchor: [0, -32],
  });
}

// Multiple visits to the same city land on identical coordinates, stacking
// the pins so only the top one is clickable. Fan duplicates out in a small
// deterministic circle (~1.5km at city scale) so every visit stays reachable.
function spreadOverlapping(places: Place[]): { place: Place; lat: number; lng: number }[] {
  const byCoord = new Map<string, Place[]>();
  for (const p of places) {
    const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
    byCoord.set(key, [...(byCoord.get(key) ?? []), p]);
  }
  const out: { place: Place; lat: number; lng: number }[] = [];
  for (const group of byCoord.values()) {
    if (group.length === 1) {
      out.push({ place: group[0], lat: group[0].latitude, lng: group[0].longitude });
      continue;
    }
    group.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / group.length;
      out.push({
        place: p,
        lat: p.latitude + 0.012 * Math.sin(angle),
        lng: p.longitude + 0.012 * Math.cos(angle),
      });
    });
  }
  return out;
}

export default function PlacesMap({
  places,
  members,
  onEdit,
}: {
  places: Place[];
  members: Member[];
  onEdit: (place: Place) => void;
}) {
  // Per-country fill color: who has been there across all of its places —
  // orange when everyone, else that member's map color.
  const countryColors = useMemo(() => {
    const visitors = new Map<string, Set<string>>();
    for (const p of places) {
      if (!p.countryCode) continue;
      if (p.countryCode === "us" && p.state) continue; // filled per state below
      const set = visitors.get(p.countryCode) ?? new Set<string>();
      for (const uid of p.withPersons) set.add(uid);
      visitors.set(p.countryCode, set);
    }
    const colors = new Map<string, string>();
    for (const [code, uids] of visitors) {
      if (uids.size >= members.length && members.length > 1) {
        colors.set(code, TOGETHER_COLOR);
      } else {
        const m = members.find((x) => uids.has(x.userId));
        colors.set(code, m ? memberMapColor(m, members) : TOGETHER_COLOR);
      }
    }
    return colors;
  }, [places, members]);

  // Same rules per US state (matched by name, as Photon reports it).
  const stateColors = useMemo(() => {
    const visitors = new Map<string, Set<string>>();
    for (const p of places) {
      if (p.countryCode !== "us" || !p.state) continue;
      const key = p.state.toLowerCase();
      const set = visitors.get(key) ?? new Set<string>();
      for (const uid of p.withPersons) set.add(uid);
      visitors.set(key, set);
    }
    const colors = new Map<string, string>();
    for (const [name, uids] of visitors) {
      if (uids.size >= members.length && members.length > 1) {
        colors.set(name, TOGETHER_COLOR);
      } else {
        const m = members.find((x) => uids.has(x.userId));
        colors.set(name, m ? memberMapColor(m, members) : TOGETHER_COLOR);
      }
    }
    return colors;
  }, [places, members]);

  const stateStyle = useMemo(
    () =>
      function style(f?: Feature): PathOptions {
        const name = f ? stateNameOf(f)?.toLowerCase() : null;
        const fill = name ? stateColors.get(name) : undefined;
        return fill
          ? { fillColor: fill, fillOpacity: 0.3, color: fill, weight: 1.2 }
          : {
              fillColor: "transparent",
              fillOpacity: 0,
              color: "#94a3b8",
              weight: 0.4, // hairline state lines
            };
      },
    [stateColors]
  );

  const countryStyle = useMemo(
    () =>
      function style(f?: Feature): PathOptions {
        const code = f ? alpha2Of(f) : null;
        const fill = code ? countryColors.get(code) : undefined;
        return fill
          ? { fillColor: fill, fillOpacity: 0.3, color: fill, weight: 1.2 }
          : {
              fillColor: "transparent",
              fillOpacity: 0,
              color: "#94a3b8", // slate-400 — crisp boundaries everywhere
              weight: 0.6,
            };
      },
    [countryColors]
  );

  return (
    <MapContainer
      center={[30, 10]}
      zoom={2}
      minZoom={2}
      scrollWheelZoom
      worldCopyJump
      style={{ height: "100%", width: "100%" }}
    >
      {/* Carto's light basemap keeps labels readable while letting the
          boundary overlay + fills carry the color. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
      />
      {/* Country boundaries; visited countries filled. key remounts the layer
          when the visited set changes — react-leaflet's GeoJSON does not
          restyle in place. interactive=false lets clicks fall through to
          pins and the map itself. */}
      <GeoJSON
        key={[...countryColors.entries()].map(([c, col]) => c + col).sort().join(",")}
        data={{ type: "FeatureCollection", features: countryFeatures } as FeatureCollection}
        style={countryStyle}
        interactive={false}
      />
      <GeoJSON
        key={"states:" + [...stateColors.entries()].map(([s, col]) => s + col).sort().join(",")}
        data={{ type: "FeatureCollection", features: stateFeatures } as FeatureCollection}
        style={stateStyle}
        interactive={false}
      />
      {spreadOverlapping(places).map(({ place: p, lat, lng }) => (
        <Marker
          key={p.id}
          position={[lat, lng]}
          icon={pinIcon(pinColor(p.withPersons, members))}
        >
          <Popup>
            <div className="min-w-40">
              <div className="font-medium">
                {flagOf(p.countryCode)} {p.name}
              </div>
              {p.country && (
                <div className="text-xs opacity-70">
                  {[p.state, p.country].filter(Boolean).join(", ")}
                </div>
              )}
              <div className="text-xs mt-1">
                {[formatVisited(p.visitedOn), whoLabel(p.withPersons, members)]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {p.tripName && (
                <div className="text-xs mt-1 opacity-70">Part of: {p.tripName}</div>
              )}
              {p.notes && <div className="text-xs mt-1 whitespace-pre-wrap">{p.notes}</div>}
              <button
                onClick={() => onEdit(p)}
                className="mt-2 text-xs underline"
                type="button"
              >
                Edit
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
