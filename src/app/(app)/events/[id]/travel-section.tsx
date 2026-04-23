"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bed,
  Car,
  ChevronRight,
  ExternalLink,
  Plane,
  Plus,
  Ship,
  Train,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export type Member = { userId: string; displayName: string; color: string };

type ReservationKind =
  | "hotel"
  | "flight"
  | "train"
  | "car_rental"
  | "ferry"
  | "transit"
  | "other";

type Reservation = {
  id: string;
  kind: ReservationKind;
  title: string;
  startAt: string; // ISO
  endAt: string | null;
  location: string | null;
  confirmationCode: string | null;
  referenceUrl: string | null;
  notes: string | null;
  origin: string | null;
  destination: string | null;
  documentUrl: string | null;
  travelerUserIds: string[];
};

const KIND_LABELS: Record<ReservationKind, string> = {
  hotel: "Hotel",
  flight: "Flight",
  train: "Train",
  car_rental: "Car rental",
  ferry: "Ferry",
  transit: "Transit",
  other: "Other",
};

function kindIcon(kind: ReservationKind, className = "h-4 w-4") {
  switch (kind) {
    case "hotel":
      return <Bed className={className} />;
    case "flight":
      return <Plane className={className} />;
    case "train":
      return <Train className={className} />;
    case "car_rental":
      return <Car className={className} />;
    case "ferry":
      return <Ship className={className} />;
    case "transit":
      return <ChevronRight className={className} />;
    default:
      return <ChevronRight className={className} />;
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TravelSection({
  holidayId,
  hasTravel,
  members,
  canEdit,
}: {
  holidayId: string;
  hasTravel: boolean;
  members: Member[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const [travel, setTravel] = useState(hasTravel);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, mutate } = useSWR<{ reservations: Reservation[] }>(
    travel ? `/api/holidays/${holidayId}/travel` : null,
    fetcher,
    { refreshInterval: 15000 }
  );
  const reservations = data?.reservations ?? [];

  const toggle = async (next: boolean) => {
    setTravel(next);
    try {
      const res = await fetch(`/api/holidays/${holidayId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hasTravel: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTravel(!next);
      toast.error("Couldn't update — try again.");
    }
  };

  const removeReservation = async (id: string) => {
    mutate(
      (prev) => ({ reservations: (prev?.reservations ?? []).filter((r) => r.id !== id) }),
      false
    );
    await fetch(`/api/holidays/${holidayId}/travel/${id}`, { method: "DELETE" });
    mutate();
  };

  return (
    <Card className="mb-4">
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">Travel</div>
            <div className="text-xs text-zinc-500">Hotels, flights, trains, transfers.</div>
          </div>
          {canEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={travel}
                onChange={(e) => toggle(e.target.checked)}
              />
              Involves travel
            </label>
          )}
        </div>

        {travel && (
          <div className="mt-4 space-y-2">
            {reservations.length === 0 ? (
              <p className="text-sm text-zinc-500">No reservations yet.</p>
            ) : (
              <ul className="space-y-2">
                {reservations.map((r) => (
                  <ReservationRow
                    key={r.id}
                    reservation={r}
                    members={members}
                    onEdit={() => canEdit && setEditing(r)}
                    onDelete={() => canEdit && removeReservation(r.id)}
                    canEdit={canEdit}
                  />
                ))}
              </ul>
            )}

            {canEdit && (
              <div className="pt-2">
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Add reservation
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {(adding || editing) && (
        <ReservationDialog
          holidayId={holidayId}
          existing={editing}
          members={members}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            mutate();
          }}
        />
      )}
    </Card>
  );
}

function ReservationRow({
  reservation: r,
  members,
  onEdit,
  onDelete,
  canEdit,
}: {
  reservation: Reservation;
  members: Member[];
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  const travelers = r.travelerUserIds
    .map((id) => members.find((m) => m.userId === id))
    .filter((x): x is Member => !!x);

  const mapsUrl = buildMapsUrl(r);

  return (
    <li>
      <Card className="p-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 h-8 w-8 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
            {kindIcon(r.kind)}
          </div>
          <div className="flex-1 min-w-0">
            <button
              onClick={onEdit}
              className="text-left font-medium truncate block w-full"
              disabled={!canEdit}
            >
              {r.title}
            </button>
            <div className="text-xs text-zinc-500 mt-0.5">
              <LocalTimeRange startIso={r.startAt} endIso={r.endAt} />
            </div>
            {(r.location || r.origin || r.destination) && (
              <div className="text-xs text-zinc-500 truncate">
                {r.kind === "flight" || r.kind === "train"
                  ? `${r.origin ?? ""}${r.destination ? ` → ${r.destination}` : ""}`
                  : r.location ?? ""}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {r.confirmationCode && (
                <span className="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.confirmationCode}
                </span>
              )}
              {travelers.length > 0 && (
                <div className="flex items-center gap-1">
                  {travelers.map((m) => (
                    <span
                      key={m.userId}
                      title={m.displayName}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-1.5 py-0 text-[10px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: m.color }}
                      />
                      {m.displayName}
                    </span>
                  ))}
                </div>
              )}
              {r.documentUrl && (
                <a
                  href={r.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                >
                  Doc <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.referenceUrl && (
                <a
                  href={r.referenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                >
                  Booking <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {mapsUrl && (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                >
                  Maps
                </a>
              )}
            </div>
            {r.notes && (
              <div className="mt-1 text-xs text-zinc-500 whitespace-pre-wrap">{r.notes}</div>
            )}
          </div>
          {canEdit && (
            <button
              onClick={onDelete}
              className="p-1 text-zinc-400 hover:text-red-500"
              title="Remove reservation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </Card>
    </li>
  );
}

// Renders the start/end datetime in the viewer's local timezone. Both ends
// are client-formatted for the same reason reservation times were — the
// server formatters live in UTC on Railway.
function LocalTimeRange({ startIso, endIso }: { startIso: string; endIso: string | null }) {
  const format = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return iso;
    }
  };
  return (
    <>
      {format(startIso)}
      {endIso ? ` → ${format(endIso)}` : ""}
    </>
  );
}

function ReservationDialog({
  holidayId,
  existing,
  members,
  onClose,
  onSaved,
}: {
  holidayId: string;
  existing: Reservation | null;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!existing;
  const [mode, setMode] = useState<"manual" | "upload">(isEdit ? "manual" : "manual");
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [savedDocUrl, setSavedDocUrl] = useState<string | null>(existing?.documentUrl ?? null);

  const [kind, setKind] = useState<ReservationKind>(existing?.kind ?? "hotel");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [startAt, setStartAt] = useState(toInputDatetime(existing?.startAt));
  const [endAt, setEndAt] = useState(toInputDatetime(existing?.endAt ?? null));
  const [location, setLocation] = useState(existing?.location ?? "");
  const [confirmationCode, setConfirmationCode] = useState(existing?.confirmationCode ?? "");
  const [origin, setOrigin] = useState(existing?.origin ?? "");
  const [destination, setDestination] = useState(existing?.destination ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [referenceUrl, setReferenceUrl] = useState(existing?.referenceUrl ?? "");
  const [travelerIds, setTravelerIds] = useState<Set<string>>(
    new Set(existing?.travelerUserIds ?? members.map((m) => m.userId))
  );
  const [busy, setBusy] = useState(false);

  const isFlightOrTrain = kind === "flight" || kind === "train";

  const toggleTraveler = (id: string) => {
    setTravelerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const analyze = async () => {
    if (!file) return;
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/holidays/${holidayId}/travel/extract`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Extraction failed");
      }
      const data = (await res.json()) as {
        extracted: {
          kind: ReservationKind;
          title: string;
          startAt: string;
          endAt: string | null;
          location: string | null;
          confirmationCode: string | null;
          origin: string | null;
          destination: string | null;
          notes: string | null;
        };
        documentUrl: string;
      };
      setKind(data.extracted.kind);
      setTitle(data.extracted.title);
      setStartAt(toInputDatetime(data.extracted.startAt));
      setEndAt(toInputDatetime(data.extracted.endAt));
      setLocation(data.extracted.location ?? "");
      setConfirmationCode(data.extracted.confirmationCode ?? "");
      setOrigin(data.extracted.origin ?? "");
      setDestination(data.extracted.destination ?? "");
      setNotes(data.extracted.notes ?? "");
      setSavedDocUrl(data.documentUrl);
      setExtracted(true);
      setMode("manual"); // switch to the form so user can review/edit
      toast.success("Pulled what I could — review the fields and save.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setBusy(true);
    if (!title.trim() || !startAt) {
      toast.error("Title and start date are required.");
      setBusy(false);
      return;
    }
    const payload = {
      kind,
      title: title.trim(),
      startAt: new Date(startAt).toISOString(),
      endAt: endAt ? new Date(endAt).toISOString() : null,
      location: location.trim() || null,
      confirmationCode: confirmationCode.trim() || null,
      origin: origin.trim() || null,
      destination: destination.trim() || null,
      notes: notes.trim() || null,
      referenceUrl: referenceUrl.trim() || null,
      documentUrl: savedDocUrl,
      travelerUserIds: Array.from(travelerIds),
    };
    try {
      const url = isEdit
        ? `/api/holidays/${holidayId}/travel/${existing!.id}`
        : `/api/holidays/${holidayId}/travel`;
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">
            {isEdit ? "Edit reservation" : "Add reservation"}
          </Dialog.Title>

          {!isEdit && (
            <div className="mt-3 flex gap-1 text-sm">
              <button
                onClick={() => setMode("manual")}
                className={`flex-1 py-1.5 rounded ${
                  mode === "manual" ? "bg-zinc-100 dark:bg-zinc-800 font-medium" : "text-zinc-500"
                }`}
              >
                Manual
              </button>
              <button
                onClick={() => setMode("upload")}
                className={`flex-1 py-1.5 rounded ${
                  mode === "upload" ? "bg-zinc-100 dark:bg-zinc-800 font-medium" : "text-zinc-500"
                }`}
              >
                Upload file
              </button>
            </div>
          )}

          {mode === "upload" && !isEdit && (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-sm dark:border-zinc-700 dark:bg-zinc-900">
                <Upload className="mx-auto h-5 w-5 text-zinc-500" />
                <p className="mt-1 text-xs text-zinc-500">
                  PDF, JPEG, PNG, WebP — up to 10MB. Claude will pull out the key fields.
                </p>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-2 text-xs"
                />
              </div>
              <Button
                onClick={analyze}
                disabled={!file || extracting}
                className="w-full gap-1"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {extracting ? "Reading…" : "Analyze"}
              </Button>
              <p className="text-xs text-zinc-500 text-center">
                You&apos;ll get to review and confirm before saving.
              </p>
            </div>
          )}

          {(mode === "manual" || isEdit) && (
            <div className="mt-4 space-y-3">
              {extracted && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                  Pulled from your file. Review, adjust if needed, then save.
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Kind</label>
                  <select
                    className="w-full h-9 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as ReservationKind)}
                  >
                    {(Object.keys(KIND_LABELS) as ReservationKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Confirmation code</label>
                  <Input
                    value={confirmationCode}
                    onChange={(e) => setConfirmationCode(e.target.value)}
                    placeholder="PNR / booking ref"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    kind === "hotel"
                      ? "Hotel name"
                      : kind === "flight"
                        ? "KL1234 AMS→JFK"
                        : kind === "train"
                          ? "NS Utrecht → Amsterdam"
                          : "Description"
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Start</label>
                  <Input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">
                    {kind === "hotel" ? "Check-out" : "End"}
                  </label>
                  <Input
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                  />
                </div>
              </div>

              {isFlightOrTrain ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">From</label>
                    <Input value={origin} onChange={(e) => setOrigin(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">To</label>
                    <Input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500">Location / address</label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Reference / booking URL (optional)</label>
                <Input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-zinc-500">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800 min-h-[60px]"
                  placeholder="Room type, seat, meal, anything useful"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-500">Who&apos;s travelling</label>
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => {
                    const on = travelerIds.has(m.userId);
                    return (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => toggleTraveler(m.userId)}
                        className={
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                          (on
                            ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                            : "border-zinc-200 bg-transparent text-zinc-600 dark:border-zinc-800 dark:text-zinc-400")
                        }
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: m.color }}
                        />
                        {m.displayName}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            {(mode === "manual" || isEdit) && (
              <Button onClick={save} disabled={busy || !title.trim() || !startAt}>
                {busy ? "Saving…" : isEdit ? "Save changes" : "Confirm and save"}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toInputDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildMapsUrl(r: {
  location: string | null;
  origin: string | null;
  destination: string | null;
  title: string;
  kind: ReservationKind;
}): string | null {
  let q = "";
  if (r.location) q = `${r.title}, ${r.location}`;
  else if (r.destination) q = r.destination;
  else if (r.origin) q = r.origin;
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
