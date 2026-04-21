"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CalendarVM = {
  id: string;
  name: string;
  color: string;
  accountId: string | null;
};

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  calendarId: string | null;
  visibility: "private" | "shared";
};

export function EventDialog({
  open,
  onClose,
  onSaved,
  calendars,
  initialEvent,
  initialSlot,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  calendars: CalendarVM[];
  initialEvent: EventRow | null;
  initialSlot: { start: Date; end: Date } | null;
}) {
  const editing = !!initialEvent;
  const start = initialEvent ? new Date(initialEvent.startsAt) : initialSlot?.start ?? new Date();
  const end = initialEvent ? new Date(initialEvent.endsAt) : initialSlot?.end ?? new Date(Date.now() + 60 * 60 * 1000);

  const [title, setTitle] = useState(initialEvent?.title ?? "");
  const [description, setDescription] = useState(initialEvent?.description ?? "");
  const [location, setLocation] = useState(initialEvent?.location ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(start));
  const [endsAt, setEndsAt] = useState(toLocalInput(end));
  const [allDay, setAllDay] = useState(initialEvent?.allDay ?? false);
  const [calendarId, setCalendarId] = useState<string>(initialEvent?.calendarId ?? calendars[0]?.id ?? "");
  const [visibility, setVisibility] = useState<"private" | "shared">(initialEvent?.visibility ?? "shared");
  const [pending, setPending] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast.error("Give it a title.");
    setPending(true);
    try {
      if (editing && initialEvent) {
        const res = await fetch(`/api/events/${initialEvent.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            description: description || null,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            allDay,
            location: location || null,
            visibility,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      } else {
        if (!calendarId) {
          toast.error("Choose a calendar to save to.");
          setPending(false);
          return;
        }
        const res = await fetch(`/api/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            calendarId,
            title,
            description: description || undefined,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            allDay,
            location: location || undefined,
            visibility,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!initialEvent) return;
    if (!confirm("Delete this event?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/events/${initialEvent.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <Dialog.Title className="text-lg font-semibold">{editing ? "Edit event" : "New event"}</Dialog.Title>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="start">Starts</Label>
                <Input id="start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">Ends</Label>
                <Input id="end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All-day
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Notes</Label>
              <Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label>Save to</Label>
                <select
                  className="h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-800"
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                >
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visibility === "private"}
                onChange={(e) => setVisibility(e.target.checked ? "private" : "shared")}
              />
              Private (only visible to you)
            </label>
          </div>
          <div className="mt-6 flex items-center justify-between">
            <div>
              {editing && (
                <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={save} disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            {editing
              ? `Last start: ${format(start, "d MMM HH:mm")}`
              : "Saved to your connected calendar."}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toLocalInput(d: Date): string {
  // <input type="datetime-local"> uses the user's local tz with a fixed format.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
