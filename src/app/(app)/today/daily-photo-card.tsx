"use client";

import useSWR from "swr";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";

type PhotoPayload = {
  photo: {
    url: string;
    caption: string | null;
    contributor: string | null;
    takenAt: string | null;
    date: string;
    locationName: string | null;
    latitude: string | null;
    longitude: string | null;
    width: number | null;
    height: number | null;
  } | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function DailyPhotoCard() {
  const { data } = useSWR<PhotoPayload>("/api/today/photo", fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });

  // Render nothing until we have a confirmed photo — no skeleton, no
  // placeholder card, so the slot is invisible unless there's content.
  if (!data?.photo) return null;

  const { url, caption, contributor, takenAt, locationName, latitude, longitude, width, height } = data.photo;
  const takenDate =
    takenAt && !Number.isNaN(new Date(takenAt).getTime())
      ? new Date(takenAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;
  const mapsUrl =
    latitude && longitude
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
      : null;

  return (
    <Card className="overflow-hidden">
      {/* Width fills the tile; height = whatever the photo's natural ratio
          gives us. width/height attributes are the original derivative
          dimensions so the browser reserves the right aspect-ratio space
          before the bytes arrive — no layout jump on first paint, and
          portrait photos render full-frame instead of having heads cropped. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={caption ?? "Photo of the day"}
        width={width ?? undefined}
        height={height ?? undefined}
        className="block w-full h-auto"
      />
      <div className="p-3 space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Photo of the day
        </div>
        {caption && <div className="text-sm font-medium">{caption}</div>}
        {(locationName || mapsUrl) && (
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <MapPin className="h-3 w-3 shrink-0" />
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline truncate"
              >
                {locationName ?? "View on map"}
              </a>
            ) : (
              <span className="truncate">{locationName}</span>
            )}
          </div>
        )}
        {(takenDate || contributor) && (
          <div className="text-xs text-zinc-500">
            {[takenDate, contributor].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </Card>
  );
}
