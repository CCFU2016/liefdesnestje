"use client";

import { useMemo } from "react";
import { groupTimeZones } from "@/lib/timezones";

// Native <select> over every IANA zone, grouped by region. Native so it
// works on the phone keyboard-free and inside Radix dialogs without focus
// juggling; the list is long but the browser's type-to-jump handles it.
export function TimeZoneSelect({
  value,
  onChange,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (tz: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const groups = useMemo(() => groupTimeZones(value), [value]);
  return (
    <select
      aria-label={ariaLabel}
      className={
        "w-full h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800 " +
        className
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {groups.map((g) => (
        <optgroup key={g.region} label={g.region}>
          {g.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
