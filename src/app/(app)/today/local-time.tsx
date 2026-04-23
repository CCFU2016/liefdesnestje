"use client";

import { useEffect, useState } from "react";

// Format an ISO timestamp in the viewer's local timezone. Rendering this on
// the server would use Railway's UTC locale, which is why restaurant
// reservations showed up 2h early for Europe/Amsterdam users.
//
// Renders a placeholder during SSR to avoid hydration mismatch, then swaps
// to the actual formatted value once mounted.
export function LocalTime({
  iso,
  fallback = "",
  options = { hour: "2-digit", minute: "2-digit" },
}: {
  iso: string;
  fallback?: string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const [value, setValue] = useState<string>(fallback);
  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    setValue(new Intl.DateTimeFormat(undefined, { ...options, hour12: false }).format(d));
  }, [iso, options]);
  return <>{value}</>;
}
