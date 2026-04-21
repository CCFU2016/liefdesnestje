"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";

type Preset =
  | { label: "None"; rrule: null }
  | { label: "Daily"; rrule: "FREQ=DAILY" }
  | { label: "Weekdays"; rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }
  | { label: "Weekly"; rrule: "FREQ=WEEKLY" }
  | { label: "Every 2 weeks"; rrule: "FREQ=WEEKLY;INTERVAL=2" }
  | { label: "Monthly"; rrule: "FREQ=MONTHLY" };

const presets: Preset[] = [
  { label: "None", rrule: null },
  { label: "Daily", rrule: "FREQ=DAILY" },
  { label: "Weekdays", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Weekly", rrule: "FREQ=WEEKLY" },
  { label: "Every 2 weeks", rrule: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Monthly", rrule: "FREQ=MONTHLY" },
];

export function RecurrencePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = presets.find((p) => p.rrule === value) ?? presets[0];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" type="button" className="gap-2">
          <Repeat className="h-3.5 w-3.5" />
          {current.label}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="rounded-md border border-zinc-200 bg-white p-1 shadow-md dark:border-zinc-800 dark:bg-zinc-950"
        >
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                onChange(p.rrule);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {p.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function describeRRule(rrule: string | null): string {
  if (!rrule) return "";
  const preset = presets.find((p) => p.rrule === rrule);
  return preset?.label ?? "Repeats";
}
