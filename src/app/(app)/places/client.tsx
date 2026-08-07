"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Dialog from "@radix-ui/react-dialog";
import { TripDialog } from "./trip-dialog";
import {
  fetcher,
  flagOf,
  formatVisited,
  memberMapColor,
  TOGETHER_COLOR,
  type Member,
  type Place,
  type SearchResult,
} from "./types";

// Leaflet can't run on the server — load the map client-side only.
const PlacesMap = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading map…
    </div>
  ),
});

export function PlacesClient({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const { data, mutate } = useSWR<{ places: Place[] }>("/api/places", fetcher, {
    refreshInterval: 30_000,
  });
  const places = useMemo(() => data?.places ?? [], [data]);

  const [dialog, setDialog] = useState<{ existing?: Place } | null>(null);
  const [tripDialog, setTripDialog] = useState<{ tripId: string; tripName: string } | null>(null);
  const [personFilter, setPersonFilter] = useState<string | "together" | null>(null);

  const filtered = useMemo(() => {
    if (!personFilter) return places;
    if (personFilter === "together") {
      return places.filter((p) => p.withPersons.length >= members.length && members.length > 1);
    }
    return places.filter((p) => p.withPersons.includes(personFilter));
  }, [places, personFilter, members]);

  // Countries visited, grouped from the filtered set. One entry per country
  // (the US included), each carrying who visited and — for the US — a
  // per-state breakdown shown when the chip is expanded.
  const countrySections = useMemo(() => {
    type CountryAgg = {
      key: string;
      code: string | null;
      name: string;
      count: number;
      visitors: Set<string>;
      states: Map<string, { name: string; count: number; visitors: Set<string> }>;
      visits: Place[];
    };
    const byCountry = new Map<string, CountryAgg>();
    for (const p of filtered) {
      const key = p.countryCode ?? p.country ?? "unknown";
      const agg =
        byCountry.get(key) ??
        ({
          key,
          code: p.countryCode,
          name: p.country ?? "Unknown",
          count: 0,
          visitors: new Set<string>(),
          states: new Map(),
          visits: [],
        } as CountryAgg);
      agg.count++;
      agg.visits.push(p);
      for (const uid of p.withPersons) agg.visitors.add(uid);
      if (p.state) {
        const s =
          agg.states.get(p.state.toLowerCase()) ??
          ({ name: p.state, count: 0, visitors: new Set<string>() });
        s.count++;
        for (const uid of p.withPersons) s.visitors.add(uid);
        agg.states.set(p.state.toLowerCase(), s);
      }
      byCountry.set(key, agg);
    }
    const all = [...byCountry.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    );
    // Same split the map colors use: both → Together, else that member's list.
    const together = all.filter(
      (c) => c.visitors.size >= members.length && members.length > 1
    );
    const perMember = members.map((m) => ({
      label: m.displayName,
      color: memberMapColor(m, members),
      countries: all.filter(
        (c) => !together.includes(c) && c.visitors.has(m.userId)
      ),
    }));
    return {
      total: all.length,
      memberTotals: members.map((m) => ({
        member: m,
        count: all.filter((c) => c.visitors.has(m.userId)).length,
      })),
      sections: [
        { label: "Together", color: TOGETHER_COLOR, countries: together },
        ...perMember,
      ].filter((s) => s.countries.length > 0),
    };
  }, [filtered, members]);
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MapPin className="h-5 w-5 text-rose-600" /> Travel map
        </h1>
        <Button onClick={() => setDialog({})} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add place
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <FilterChip label="All" active={personFilter === null} onClick={() => setPersonFilter(null)} />
        {members.map((m) => (
          <FilterChip
            key={m.userId}
            label={m.displayName}
            color={memberMapColor(m, members)}
            active={personFilter === m.userId}
            onClick={() => setPersonFilter(personFilter === m.userId ? null : m.userId)}
          />
        ))}
        {members.length > 1 && (
          <FilterChip
            label="Together"
            color={TOGETHER_COLOR}
            active={personFilter === "together"}
            onClick={() => setPersonFilter(personFilter === "together" ? null : "together")}
          />
        )}
      </div>

      {/* isolate + z-0 traps Leaflet's internal z-indexes (panes go up to
          ~1000) inside this box, so dialogs at z-40/z-50 render above it. */}
      <div className="relative z-0 isolate rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden h-[55vh] min-h-80">
        <PlacesMap
          places={filtered}
          members={members}
          onEdit={(place) => setDialog({ existing: place })}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        {members.map((m) => (
          <span key={m.userId} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: memberMapColor(m, members) }}
            />
            {m.displayName}
          </span>
        ))}
        {members.length > 1 && (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: TOGETHER_COLOR }}
            />
            Together
          </span>
        )}
      </div>

      <Card className="mt-4">
        <CardContent className="py-3">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h2 className="text-sm font-medium">
              Countries visited{" "}
              <span className="text-zinc-500 font-normal">· {countrySections.total}</span>
            </h2>
            <span className="text-xs text-zinc-500">
              {filtered.length} place{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          {countrySections.total > 0 && (
            <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
              {countrySections.memberTotals.map(({ member, count }) => (
                <span
                  key={member.userId}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-800"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: memberMapColor(member, members) }}
                  />
                  <span className="font-medium">{member.displayName}</span>
                  <span className="text-zinc-500">
                    {count} {count === 1 ? "country" : "countries"}
                  </span>
                </span>
              ))}
            </div>
          )}
          {countrySections.total === 0 ? (
            <p className="text-sm text-zinc-500">
              No pins yet — add the first place you two have been.
            </p>
          ) : (
            <div className="space-y-3">
              {countrySections.sections.map((section) => (
                <div key={section.label}>
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: section.color }}
                    />
                    {section.label} · {section.countries.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {section.countries.map((c) => {
                      const expanded = expandedCountry === `${section.label}:${c.key}`;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() =>
                            setExpandedCountry(expanded ? null : `${section.label}:${c.key}`)
                          }
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-600" +
                            (expanded ? " border-zinc-500 dark:border-zinc-400" : "")
                          }
                          title={`${c.count} visit${c.count === 1 ? "" : "s"} — click to see them`}
                        >
                          {flagOf(c.code)} {c.name}
                          {c.count > 1 && <span className="text-zinc-400">×{c.count}</span>}
                          <span className="text-zinc-400">{expanded ? "▾" : "▸"}</span>
                        </button>
                      );
                    })}
                  </div>
                  {section.countries
                    .filter((c) => expandedCountry === `${section.label}:${c.key}`)
                    .map((c) => (
                      <div key={c.key} className="mt-1.5 ml-3 space-y-1.5">
                        {c.states.size > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {[...c.states.values()]
                              .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
                              .map((s) => {
                                const dot =
                                  s.visitors.size >= members.length && members.length > 1
                                    ? TOGETHER_COLOR
                                    : memberMapColor(
                                        members.find((m) => s.visitors.has(m.userId)) ?? members[0],
                                        members
                                      );
                                return (
                                  <span
                                    key={s.name}
                                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-800"
                                    title={`${s.count} place${s.count === 1 ? "" : "s"}`}
                                  >
                                    <span
                                      className="inline-block h-1.5 w-1.5 rounded-full"
                                      style={{ background: dot }}
                                    />
                                    {s.name}
                                    {s.count > 1 && <span className="text-zinc-400">×{s.count}</span>}
                                  </span>
                                );
                              })}
                          </div>
                        )}
                        <ul className="space-y-0.5">
                          {groupVisitsByTrip(c.visits).map((row) => (
                            <li
                              key={row.key}
                              className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400"
                            >
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                                style={{
                                  background:
                                    row.withPersons.length >= members.length && members.length > 1
                                      ? TOGETHER_COLOR
                                      : memberMapColor(
                                          members.find((m) => row.withPersons.includes(m.userId)) ??
                                            members[0],
                                          members
                                        ),
                                }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  row.single
                                    ? setDialog({ existing: row.single })
                                    : setTripDialog({ tripId: row.key, tripName: row.label })
                                }
                                className="hover:underline text-left"
                              >
                                {row.label}
                              </button>
                              {row.stops > 1 && (
                                <span className="text-zinc-400">
                                  · {row.stops} stops
                                </span>
                              )}
                              {formatVisited(row.visitedOn) && (
                                <span className="text-zinc-400">· {formatVisited(row.visitedOn)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {tripDialog && (
        <TripDialog
          tripId={tripDialog.tripId}
          tripName={tripDialog.tripName}
          stops={places.filter((p) => p.tripId === tripDialog.tripId)}
          members={members}
          onClose={() => setTripDialog(null)}
          onSaved={() => {
            setTripDialog(null);
            mutate();
          }}
        />
      )}
      {dialog && (
        <PlaceDialog
          existing={dialog.existing}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}

type VisitRow = {
  key: string;
  label: string;
  visitedOn: string | null;
  withPersons: string[];
  stops: number;
  single: Place | null; // set when the row is one loose pin → click to edit
};

function groupVisitsByTrip(visits: Place[]): VisitRow[] {
  const rows = new Map<string, VisitRow>();
  for (const v of visits) {
    if (!v.tripId) {
      rows.set(v.id, {
        key: v.id,
        label: v.name + (v.state ? `, ${v.state}` : ""),
        visitedOn: v.visitedOn,
        withPersons: v.withPersons,
        stops: 1,
        single: v,
      });
      continue;
    }
    const row =
      rows.get(v.tripId) ??
      ({
        key: v.tripId,
        label: v.tripName ?? "Trip",
        visitedOn: v.visitedOn,
        withPersons: [],
        stops: 0,
        single: null,
      } as VisitRow);
    row.stops++;
    row.visitedOn = row.visitedOn ?? v.visitedOn;
    row.withPersons = [...new Set([...row.withPersons, ...v.withPersons])];
    rows.set(v.tripId, row);
  }
  return [...rows.values()].sort((a, b) =>
    (b.visitedOn ?? "").localeCompare(a.visitedOn ?? "")
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
        (active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400")
      }
    >
      {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}

function PlaceDialog({
  existing,
  members,
  currentUserId,
  onClose,
  onSaved,
}: {
  existing?: Place;
  members: Member[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [stops, setStops] = useState<SearchResult[]>([]);
  const [tripName, setTripName] = useState("");
  const [name, setName] = useState(existing?.name ?? "");
  // Flexible visit date: exact (YYYY-MM-DD), month (YYYY-MM), year (YYYY),
  // or none. Precision is derived from the stored string length when editing.
  // New entries default to month precision — "June 2019" is how most trips
  // are remembered; exact dates stay available in the dropdown.
  const [datePrecision, setDatePrecision] = useState<"date" | "month" | "year" | "none">(
    !existing || existing.visitedOn === undefined
      ? "month"
      : existing.visitedOn === null
        ? "none"
        : existing.visitedOn.length === 4
          ? "year"
          : existing.visitedOn.length === 7
            ? "month"
            : "date"
  );
  const [visitedOn, setVisitedOn] = useState(existing?.visitedOn ?? "");
  const [withPersons, setWithPersons] = useState<Set<string>>(
    new Set(existing?.withPersons ?? members.map((m) => m.userId))
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [busy, setBusy] = useState(false);

  // Debounced city autocomplete: fires ~450ms after typing pauses. The
  // request id guard drops out-of-order responses (fast typing).
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
        // network blip — keep the old results, user can keep typing
      } finally {
        if (requestId.current === id) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  const pick = (r: SearchResult) => {
    setStops((prev) => [...prev, r]);
    setResults([]);
    setQuery("");
  };

  const togglePerson = (uid: string) => {
    const next = new Set(withPersons);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    if (next.size === 0) return; // at least one person was there
    setWithPersons(next);
  };

  const save = async () => {
    if (!existing && stops.length === 0) return toast.error("Add at least one city first.");
    if (existing && !name.trim()) return toast.error("Give the place a name.");
    const expectedLen = { date: 10, month: 7, year: 4 }[datePrecision as "date" | "month" | "year"];
    const visitedValue =
      datePrecision === "none" ? null : visitedOn.slice(0, expectedLen) || null;
    if (datePrecision !== "none" && !visitedValue) {
      return toast.error("Fill in the date — or set it to 'No date'.");
    }
    setBusy(true);
    try {
      const res = existing
        ? await fetch(`/api/places/${existing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              visitedOn: visitedValue,
              withPersons: Array.from(withPersons),
              notes: notes.trim() || null,
            }),
          })
        : await fetch("/api/places", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              stops: stops.map((s) => ({
                name: s.name,
                country: s.country,
                countryCode: s.countryCode,
                state: s.state,
                latitude: s.latitude,
                longitude: s.longitude,
              })),
              tripName: tripName.trim() || null,
              visitedOn: visitedValue,
              withPersons: Array.from(withPersons),
              notes: notes.trim() || null,
            }),
          });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      toast.success(
        existing ? "Saved" : stops.length > 1 ? `${stops.length} pins added! 📍` : "Pinned! 📍"
      );
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm(`Remove "${existing.name}" from the map?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/places/${existing.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Removed");
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
          <Dialog.Title className="text-lg font-semibold">
            {existing ? "Edit place" : "Add a place"}
          </Dialog.Title>

          <div className="mt-4 space-y-3">
            {!existing && (
              <div className="space-y-1.5">
                <Label htmlFor="pl-search">
                  {stops.length === 0 ? "City" : "Add another city"}
                </Label>
                <div className="relative">
                  <Input
                    id="pl-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Start typing… Lisbon, Kyoto, Paramaribo"
                    autoFocus
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
                          onClick={() => pick(r)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        >
                          <span className="mr-1">{flagOf(r.countryCode)}</span>
                          {r.displayName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {stops.length > 0 && (
                  <ul className="space-y-1 mt-1">
                    {stops.map((s, i) => (
                      <li key={`${s.id}-${i}`} className="flex items-center gap-2 text-xs">
                        <span>{flagOf(s.countryCode)}</span>
                        <span className="truncate flex-1">{s.displayName}</span>
                        <button
                          type="button"
                          onClick={() => setStops(stops.filter((_, j) => j !== i))}
                          className="text-zinc-400 hover:text-red-500"
                          aria-label={`Remove ${s.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {stops.length > 1 && (
                  <div className="pt-1">
                    <Input
                      value={tripName}
                      onChange={(e) => setTripName(e.target.value)}
                      placeholder={`Trip name (optional) — e.g. "${stops[0].name} roadtrip"`}
                    />
                  </div>
                )}
              </div>
            )}
            {existing?.tripName && (
              <p className="text-xs text-zinc-500">Part of trip: {existing.tripName}</p>
            )}

            {existing && (
              <div className="space-y-1.5">
                <Label htmlFor="pl-name">Name</Label>
                <Input
                  id="pl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Weekend in Lisbon"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pl-date">Visited</Label>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
                  value={datePrecision}
                  onChange={(e) => {
                    const p = e.target.value as typeof datePrecision;
                    setDatePrecision(p);
                    // Trim an existing value to the new precision so switching
                    // date → year keeps "2019" instead of clearing.
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
                    id="pl-date"
                    type="date"
                    value={visitedOn}
                    onChange={(e) => setVisitedOn(e.target.value)}
                  />
                )}
                {datePrecision === "month" && (
                  <Input
                    id="pl-date"
                    type="month"
                    value={visitedOn}
                    onChange={(e) => setVisitedOn(e.target.value)}
                  />
                )}
                {datePrecision === "year" && (
                  <Input
                    id="pl-date"
                    type="number"
                    min={1950}
                    max={2100}
                    placeholder="2019"
                    value={visitedOn}
                    onChange={(e) => setVisitedOn(e.target.value.slice(0, 4))}
                  />
                )}
              </div>
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
                      {m.userId === currentUserId ? " (me)" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pl-notes">Notes</Label>
              <textarea
                id="pl-notes"
                className="w-full min-h-16 rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="That little restaurant by the harbour…"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <div>
              {existing && (
                <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy
                  ? "Saving…"
                  : existing
                    ? "Save"
                    : stops.length > 1
                      ? `Add ${stops.length} pins`
                      : "Add pin"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
