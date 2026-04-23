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

// Hero card showing today's random pick from the connected iCloud shared
// album. Renders nothing when no album is set so it stays out of the way
// for people who haven't opted in.
export function DailyPhotoCard() {
  const { data, isLoading } = useSWR<PhotoPayload>("/api/today/photo", fetcher, {
    // The pick is stable per day per household — no need to poll.
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });

  if (isLoading) {
    return (
      <Card className="md:col-span-2 overflow-hidden">
        <div className="aspect-[16/9] w-full bg-zinc-100 dark:bg-zinc-900 animate-pulse" />
      </Card>
    );
  }

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
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={caption ?? "Photo of the day"}
          className="w-full max-h-[70vh] object-cover"
        />
        {(caption || contributor || takenDate) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 text-white">
            {caption && <div className="text-sm font-medium">{caption}</div>}
            <div className="text-[11px] text-white/80">
              {[contributor, takenDate].filter(Boolean).join(" · ")}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
