"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CALENDAR_COLOR_PRESETS, type Account, type CalendarVM } from "../types";

export function IcsAdder({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ics-calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't add");
      toast.success("Added — fetching events…");
      setName("");
      setUrl("");
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="pt-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          + Add calendar via ICS link
        </Button>
        <p className="text-[11px] text-zinc-500 mt-1">
          Read-only. Think holiday calendars, sports schedules, or the &quot;share URL&quot; a co-worker sent you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
      <p className="text-xs uppercase tracking-wider text-zinc-500">New ICS subscription</p>
      <div className="space-y-1">
        <Input
          placeholder="Name (e.g. Dutch holidays)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <Input
          placeholder="https://…/calendar.ics  (webcal:// also works)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Fetching…" : "Add"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Refreshes automatically every 6 hours; deleted events get removed on the next refresh.
      </p>
    </form>
  );
}

export function AccountRow({
  account,
  onChanged,
}: {
  account: Account;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const disconnect = async () => {
    if (
      !confirm(
        `Disconnect ${account.provider === "microsoft" ? "Microsoft" : "Google"} (${account.externalAccountId})?\n\nLiefdesnestje stops syncing and removes the local copy of all calendars + events from this account. Nothing changes in the source ${account.provider === "microsoft" ? "Outlook" : "Google Calendar"}.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/calendar-accounts/${account.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Disconnected");
      onChanged();
    } catch {
      toast.error("Couldn't disconnect. Try again.");
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center justify-between text-sm py-1">
      <div>
        <span className="capitalize font-medium">{account.provider}</span> — {account.externalAccountId}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={disconnect}
        disabled={busy}
        className="text-zinc-500 hover:text-red-500"
      >
        {busy ? "Disconnecting…" : "Disconnect"}
      </Button>
    </li>
  );
}

export function CalendarRow({
  cal,
  onChanged,
}: {
  cal: CalendarVM;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cal.name);
  const [busy, setBusy] = useState(false);
  const canEdit = cal.ownerIsMe;

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/calendars/${cal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!name.trim() || name === cal.name) {
      setEditing(false);
      setName(cal.name);
      return;
    }
    await patch({ name: name.trim() });
    setEditing(false);
  };

  const toggleSync = () => patch({ syncEnabled: !cal.syncEnabled });
  const toggleToday = () => patch({ showOnToday: !cal.showOnToday });

  const remove = async () => {
    const source =
      cal.provider === "microsoft"
        ? "Outlook"
        : cal.provider === "google"
          ? "Google Calendar"
          : "the source URL";
    if (
      !confirm(
        `Remove "${cal.name}" from Liefdesnestje? Its events disappear here. Nothing changes in ${source}.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/calendars/${cal.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Removed");
      onChanged();
    } catch {
      toast.error("Couldn't remove. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cycleColor = () => {
    const current = cal.color;
    const idx = CALENDAR_COLOR_PRESETS.indexOf(current);
    const next =
      idx === -1
        ? CALENDAR_COLOR_PRESETS[0]
        : CALENDAR_COLOR_PRESETS[(idx + 1) % CALENDAR_COLOR_PRESETS.length];
    patch({ color: next });
  };

  return (
    <li className="flex items-center gap-2 py-1.5">
      {canEdit ? (
        <button
          onClick={cycleColor}
          disabled={busy}
          className="h-4 w-4 rounded-sm shrink-0 ring-1 ring-zinc-200 dark:ring-zinc-700 cursor-pointer hover:scale-110 transition-transform"
          style={{ background: cal.color }}
          title="Click to change color"
        />
      ) : (
        <span
          className="inline-block h-4 w-4 rounded-sm shrink-0"
          style={{ background: cal.color }}
          title={cal.color}
        />
      )}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="flex gap-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setEditing(false);
                  setName(cal.name);
                }
              }}
            />
            <Button size="icon" variant="ghost" onClick={saveName} disabled={busy} className="h-7 w-7">
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setName(cal.name);
              }}
              className="h-7 w-7"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-sm truncate">{cal.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0">
                {cal.provider}
                {cal.provider !== "ics" && !cal.ownerIsMe && ` · ${cal.ownerDisplayName}`}
                {cal.provider === "ics" && " · subscription"}
              </span>
            </div>
            {cal.lastError && (
              <div className="text-[11px] text-red-500 flex items-center gap-1.5">
                <span className="truncate" title={cal.lastError}>
                  ⚠ {cal.lastError}
                </span>
                {cal.provider === "ics" && (
                  <button
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await fetch(`/api/ics-calendars/${cal.id}/refresh`, {
                          method: "POST",
                        });
                        if (!res.ok) {
                          const body = await res.json().catch(() => ({}));
                          throw new Error(body.error ?? `Refresh failed (${res.status})`);
                        }
                        toast.success("Refreshed");
                        onChanged();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Refresh failed");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy}
                    className="underline shrink-0 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50"
                  >
                    retry
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {canEdit && !editing && (
        <>
          <label
            className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer"
            title="Sync this calendar and show on the main Calendar page"
          >
            <input
              type="checkbox"
              checked={cal.syncEnabled}
              onChange={toggleSync}
              disabled={busy}
            />
            Sync
          </label>
          <label
            className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer"
            title="Show events from this calendar on the Today overview"
          >
            <input
              type="checkbox"
              checked={cal.showOnToday}
              onChange={toggleToday}
              disabled={busy || !cal.syncEnabled}
            />
            Today
          </label>
          <Button size="icon" variant="ghost" onClick={() => setEditing(true)} className="h-7 w-7" title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={remove}
            disabled={busy}
            className="h-7 w-7 text-zinc-500 hover:text-red-500"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}

