"use client";

import useSWR from "swr";
import { Card } from "@/components/ui/card";

type PhotoPayload = {
  photo: {
    url: string;
    caption: string | null;
    contributor: string | null;
    takenAt: string | null;
    date: string;
  } | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Small photo-of-the-day card, rendered at the bottom of Today. Hidden
// entirely while loading AND when no album is configured, so there's no
// empty frame flashing in and out.
export function DailyPhotoCard() {
  const { data } = useSWR<PhotoPayload>("/api/today/photo", fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });

  // Render nothing until we have a confirmed photo — no skeleton, no
  // placeholder card, so the slot is invisible unless there's content.
  if (!data?.photo) return null;

  const { url, caption, contributor, takenAt } = data.photo;
  const takenDate =
    takenAt && !Number.isNaN(new Date(takenAt).getTime())
      ? new Date(takenAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <Card className="md:col-span-2 overflow-hidden">
      <div className="flex items-stretch gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={caption ?? "Photo of the day"}
          className="h-24 w-24 sm:h-28 sm:w-28 object-cover shrink-0"
        />
        <div className="flex flex-col justify-center min-w-0 py-2 pr-3">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">
            Photo of the day
          </div>
          {caption && <div className="text-sm font-medium truncate">{caption}</div>}
          {(contributor || takenDate) && (
            <div className="text-xs text-zinc-500 truncate">
              {[contributor, takenDate].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
