"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Dialog from "@radix-ui/react-dialog";
import {
  flagOf,
  memberMapColor,
  type Member,
  type Place,
  type SearchResult,
} from "./types";

/**
 * Edit a whole trip: rename, add/remove stops, and change the shared
 * date / who / notes (applied to every stop). Individual stops are still
 * editable via their pins on the map.
 */
export function TripDialog({
  tripId,
  tripName,
  stops,
  members,
  onClose,
  onSaved,
}: {
  tripId: string;
  tripName: string;
  stops: Place[]; // all live places of this trip, across countries
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const seed = stops[0];
  const [name, setName] = useState(tripName);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<SearchResult[]>([]);
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [withPersons, setWithPersons] = useState<Set<string>>(
    new Set(seed?.withPersons ?? members.map((m) => m.userId))
  );
  const [datePrecision, setDatePrecision] = useState<"date" | "month" | "year" | "none">(
    !seed?.visitedOn
      ? "none"
      : seed.visitedOn.length === 4
        ? "year"
        : seed.visitedOn.length === 7
          ? "month"
          : "date"
  );
  const [visitedOn, setVisitedOn] = useState(seed?.visitedOn ?? "");
  const [busy, setBusy] = useState(false);

  // Debounced city autocomplete — same pattern as the add-place dialog.
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const requestId = useRef(0);
  useEffect(() => {
    const q = query.trim();
    const id = ++requestId.current;
    const t = setTimeout(async () => {
      if (q.length < 3) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}`);
        const body = (await res.json()) as { results: SearchResult[] };
        if (requestId.current === id) setResults(body.results ?? []);
      } catch {
        // network blip — user can keep typing
      } finally {
        if (requestId.current === id) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  const keptStops = stops.filter((s) => !removedIds.has(s.id));

  const togglePerson = (uid: string) => {
    const next = new Set(withPersons);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    if (next.size === 0) return;
    setWithPersons(next);
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Give the trip a name.");
    if (keptStops.length + added.length === 0) {
      return toast.error("A trip needs at least one stop — use Delete trip instead.");
    }
    const expectedLen = { date: 10, month: 7, year: 4 }[
      datePrecision as "date" | "month" | "year"
    ];
    // An empty date field simply means "no date" — never block the save.
    const visitedValue =
      datePrecision === "none" ? null : visitedOn.slice(0, expectedLen) || null;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          visitedOn: visitedValue,
          withPersons: Array.from(withPersons),
          notes: notes.trim() || null,
          addStops: added.map((s) => ({
            name: s.name,
            country: s.country,
            countryCode: s.countryCode,
            state: s.state,
            latitude: s.latitude,
            longitude: s.longitude,
          })),
          removePlaceIds: Array.from(removedIds),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      toast.success("Trip updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  const removeTrip = async () => {
    if (
      !confirm(
        `Delete "${tripName}" and its ${stops.length} pin${stops.length === 1 ? "" : "s"}? This can't be undone.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Trip deleted");
      onSaved();
    } catch {
      toast.error("Delete failed");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">Edit trip</Dialog.Title>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tr-name">Trip name</Label>
              <Input id="tr-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Stops</Label>
              <ul className="space-y-1">
                {keptStops.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span>{flagOf(s.countryCode)}</span>
                    <span className="truncate flex-1">
                      {s.name}
                      {s.state ? `, ${s.state}` : ""}
                      {s.country ? ` (${s.country})` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRemovedIds(new Set([...removedIds, s.id]))}
                      className="text-zinc-400 hover:text-red-500"
                      aria-label={`Remove ${s.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
                {added.map((s, i) => (
                  <li key={`new-${s.id}-${i}`} className="flex items-center gap-2 text-xs">
                    <span>{flagOf(s.countryCode)}</span>
                    <span className="truncate flex-1">
                      {s.displayName} <span className="text-emerald-600">· new</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAdded(added.filter((_, j) => j !== i))}
                      className="text-zinc-400 hover:text-red-500"
                      aria-label={`Remove ${s.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="relative">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Add another city…"
                  autoComplete="off"
                />
                {searching && (
                  <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-zinc-400" />
                )}
              </div>
              {results.length > 0 && (
                <ul className="rounded-md border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-900 max-h-44 overflow-y-auto">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setAdded([...added, r]);
                          setResults([]);
                          setQuery("");
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <span className="mr-1">{flagOf(r.countryCode)}</span>
                        {r.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tr-date">Visited</Label>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
                  value={datePrecision}
                  onChange={(e) => {
                    const p = e.target.value as typeof datePrecision;
                    setDatePrecision(p);
                    if (p === "none") setVisitedOn("");
                    else if (p === "year") setVisitedOn(visitedOn.slice(0, 4));
                    else if (p === "month") setVisitedOn(visitedOn.slice(0, 7));
                  }}
                >
                  <option value="date">Exact date</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                  <option value="none">No date</option>
                </select>
                {datePrecision === "date" && (
                  <Input
                    id="tr-date"
                    type="date"
                    value={visitedOn}
                    onChange={(e) => setVisitedOn(e.target.value)}
                  />
                )}
                {datePrecision === "month" && (
                  <Input
                    id="tr-date"
                    type="month"
                    value={visitedOn}
                    onChange={(e) => setVisitedOn(e.target.value)}
                  />
                )}
                {datePrecision === "year" && (
                  <Input
                    id="tr-date"
                    type="number"
                    min={1950}
                    max={2100}
                    placeholder="2019"
                    value={visitedOn}
                    onChange={(e) => setVisitedOn(e.target.value.slice(0, 4))}
                  />
                )}
              </div>
              <p className="text-[11px] text-zinc-500">
                Date, who, and notes apply to every stop of the trip.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Who was there?</Label>
              <div className="flex gap-2">
                {members.map((m) => {
                  const on = withPersons.has(m.userId);
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => togglePerson(m.userId)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                        (on
                          ? "border-zinc-900 dark:border-zinc-100"
                          : "border-zinc-200 opacity-50 dark:border-zinc-800")
                      }
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: memberMapColor(m, members) }}
                      />
                      {m.displayName}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tr-notes">Notes</Label>
              <textarea
                id="tr-notes"
                className="w-full min-h-16 rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <Button variant="destructive" size="sm" onClick={removeTrip} disabled={busy}>
              Delete trip
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
