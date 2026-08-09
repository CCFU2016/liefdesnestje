"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { format } from "date-fns";
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
  organizerName?: string | null;
  organizerEmail?: string | null;
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
  // Seed dates once at mount (the dialog is remounted per event/slot, and the
  // form state below only reads them at mount anyway). Lazy useState keeps the
  // impure `new Date()` out of render.
  const [{ start, end }] = useState(() => ({
    start: initialEvent ? new Date(initialEvent.startsAt) : initialSlot?.start ?? new Date(),
    end: initialEvent
      ? new Date(initialEvent.endsAt)
      : initialSlot?.end ?? new Date(Date.now() + 60 * 60 * 1000),
  }));

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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_10px_30px_rgba(9,9,11,0.08)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          <div className="max-h-[85vh] overflow-y-auto px-5 pt-5 pb-5">
          <Dialog.Title className="text-base font-semibold tracking-tight">{editing ? "Edit event" : "New event"}</Dialog.Title>
          {initialEvent && (initialEvent.organizerName || initialEvent.organizerEmail) && (
            <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
              Invited by {initialEvent.organizerName ?? initialEvent.organizerEmail}
              {initialEvent.organizerName && initialEvent.organizerEmail && (
                <> ({initialEvent.organizerEmail})</>
              )}
            </p>
          )}
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
            <button
              type="button"
              onClick={() => setVisibility(visibility === "private" ? "shared" : "private")}
              className="flex w-full items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5 text-left dark:border-zinc-800"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-zinc-900 dark:text-zinc-50">Private</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Only you see the details
                </span>
              </span>
              <span
                className={`flex h-5 w-9 flex-none rounded-full p-0.5 transition-colors ${
                  visibility === "private" ? "" : "bg-zinc-200 dark:bg-zinc-700"
                }`}
                style={
                  visibility === "private" ? { background: "var(--cal-accent)" } : undefined
                }
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    visibility === "private" ? "translate-x-4" : ""
                  }`}
                />
              </span>
            </button>
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            {editing
              ? `Last start: ${format(start, "d MMM HH:mm")}`
              : "Saved to your connected calendar."}
          </div>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-zinc-800 dark:bg-[#0f0f11]">
            <div>
              {editing && (
                <button
                  onClick={remove}
                  disabled={pending}
                  className="flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3.5 text-sm text-red-700 hover:bg-red-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={pending}
                className="flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "var(--cal-accent)" }}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
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
