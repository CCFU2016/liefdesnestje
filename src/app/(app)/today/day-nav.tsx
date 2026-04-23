"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Small prev/today/next navigator above the Today-page cards. Uses plain
// links so it works without JS; a tiny keyboard handler adds ArrowLeft /
// ArrowRight shortcuts for quick scrubbing.
export function DayNav({
  prevDate,
  nextDate,
  showTodayLink,
}: {
  prevDate: string;
  nextDate: string;
  showTodayLink: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in a field or holding a modifier
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key === "ArrowLeft") router.push(`/today?date=${prevDate}`);
      else if (e.key === "ArrowRight") router.push(`/today?date=${nextDate}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevDate, nextDate, router]);

  return (
    <div className="mt-4 flex items-center gap-2">
      <Link
        href={`/today?date=${prevDate}`}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="Previous day"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Prev
      </Link>
      <Link
        href={`/today?date=${nextDate}`}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="Next day"
      >
        Next <ChevronRight className="h-3.5 w-3.5" />
      </Link>
      {/* Today button comes AFTER Next so Prev/Next positions never shift as
          we scrub between today and other days. When viewing today the button
          is still rendered but hidden via visibility: hidden to keep the
          overall row width stable — JS shortcuts (ArrowLeft/Right) still work. */}
      <Link
        href="/today"
        className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        style={{ visibility: showTodayLink ? "visible" : "hidden" }}
        aria-hidden={!showTodayLink}
        tabIndex={showTodayLink ? 0 : -1}
      >
        Today
      </Link>
    </div>
  );
}
