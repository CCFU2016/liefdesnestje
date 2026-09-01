"use client";

import { useEffect, useState } from "react";

// Format an ISO timestamp in the viewer's local timezone. Rendering this on
// the server would use Railway's UTC locale, which is why restaurant
// reservations showed up 2h early for Europe/Amsterdam users.
//
// Renders a placeholder during SSR to avoid hydration mismatch, then swaps
// to the actual formatted value once mounted.
//
// Pass `timeZone` to pin the output to a specific IANA zone instead (a
// flight's departure is shown in the departure city's time, not the
// viewer's). That output is deterministic, so it renders on the server too
// and carries a short zone label so the reader knows which clock it is.
export function LocalTime({
  iso,
  fallback = "",
  options = { hour: "2-digit", minute: "2-digit" },
  timeZone,
}: {
  iso: string;
  fallback?: string;
  options?: Intl.DateTimeFormatOptions;
  timeZone?: string;
}) {
  const [value, setValue] = useState<string>(() =>
    timeZone ? formatIn(iso, options, timeZone) ?? fallback : fallback
  );
  useEffect(() => {
    const next = formatIn(iso, options, timeZone);
    if (next !== null) setValue(next);
  }, [iso, options, timeZone]);
  return <>{value}</>;
}

function formatIn(iso: string, options: Intl.DateTimeFormatOptions, timeZone?: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      hour12: false,
      ...(timeZone ? { timeZone, timeZoneName: "short" } : {}),
    }).format(d);
  } catch {
    return null;
  }
}
