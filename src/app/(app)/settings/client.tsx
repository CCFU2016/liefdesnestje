"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Member = {
  userId: string;
  displayName: string;
  color: string;
  role: "owner" | "member";
};

type Account = {
  id: string;
  provider: "google" | "microsoft";
  externalAccountId: string;
  expiresAt: Date;
};

type CalendarVM = {
  id: string;
  name: string;
  color: string;
  syncEnabled: boolean;
  showOnToday: boolean;
  provider: "google" | "microsoft" | "ics";
  accountEmail: string;
  ownerUserId: string | null;
  ownerIsMe: boolean;
  ownerDisplayName: string;
  lastSyncedAt: string | Date | null;
  lastError: string | null;
  icsUrl: string | null;
  writable: boolean;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function SettingsClient({
  household,
  members,
  currentUserId,
  myAccounts,
}: {
  household: { id: string; name: string } | undefined;
  members: Member[];
  currentUserId: string;
  myAccounts: Account[];
}) {
  const [pending, start] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const me = members.find((m) => m.userId === currentUserId);
  const partner = members.find((m) => m.userId !== currentUserId);

  const { data: calendarsData, mutate: mutateCalendars } = useSWR<{ calendars: CalendarVM[] }>(
    "/api/calendars",
    fetcher
  );

  const createInvite = () => {
    start(async () => {
      try {
        const res = await fetch("/api/households/invite", { method: "POST" });
        if (!res.ok) throw new Error("Could not create invite");
        const { url } = await res.json();
        setInviteUrl(url);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  };

  const connectMicrosoft = () => (window.location.href = "/api/integrations/microsoft/start");
  const connectGoogle = () => (window.location.href = "/api/integrations/google/start");

  const syncNow = async () => {
    try {
      const res = await fetch("/api/calendar-sync", { method: "POST" });
      if (!res.ok) throw new Error();
      const { upserted, removed } = await res.json();
      toast.success(`Synced — ${upserted} updated, ${removed} removed`);
      mutateCalendars();
    } catch {
      toast.error("Sync failed. Try again.");
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6 md:p-10 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Your nest</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            <span className="text-zinc-500">Name:</span> {household?.name}
          </div>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 text-sm">
                <span className="inline-block h-4 w-4 rounded-full" style={{ background: m.color }} />
                <span>{m.displayName}</span>
                <span className="text-xs text-zinc-500">
                  {m.role === "owner" ? "Owner" : "Member"}
                  {m.userId === currentUserId ? " (you)" : ""}
                </span>
              </div>
            ))}
          </div>
          {!partner && (
            <div className="pt-2">
              {inviteUrl ? (
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
                  <p className="text-xs text-zinc-500 mb-2">Share this link with your partner (expires in 7 days):</p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={inviteUrl}
                      className="flex-1 text-xs bg-transparent border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(inviteUrl);
                        toast.success("Copied!");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={createInvite} disabled={pending}>
                  {pending ? "Creating…" : "Invite your partner"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Calendar connections</CardTitle>
          <Button size="sm" variant="ghost" onClick={syncNow} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Sync now
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {myAccounts.length === 0 ? (
            <p className="text-sm text-zinc-500">No calendars connected yet.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-zinc-500">Your linked accounts</p>
              <ul className="space-y-1">
                {myAccounts.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    onChanged={() => {
                      mutateCalendars();
                      // Server component needs a full refresh to update myAccounts
                      window.location.reload();
                    }}
                  />
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={connectMicrosoft} variant="secondary">
              Connect Microsoft calendar
            </Button>
            <Button onClick={connectGoogle} variant="secondary">
              Connect Google calendar
            </Button>
          </div>

          <IcsAdder onAdded={mutateCalendars} />

          {(calendarsData?.calendars?.length ?? 0) > 0 && (
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
                Calendars shown on the calendar page
              </p>
              <ul className="space-y-1">
                {calendarsData!.calendars.map((c) => (
                  <CalendarRow key={c.id} cal={c} onChanged={() => mutateCalendars()} />
                ))}
              </ul>
              <p className="text-[11px] text-zinc-500 mt-3">
                Disabling sync hides a calendar from the grid without disconnecting. Removing it stops syncing and deletes the local copy of its events — nothing is removed from {`{Microsoft/Google}`}.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {me && (
        <Card>
          <CardHeader>
            <CardTitle>You</CardTitle>
          </CardHeader>
          <CardContent>
            <YouEditor
              me={me}
              takenColors={members.filter((m) => m.userId !== currentUserId).map((m) => m.color)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const PRESET_COLORS = [
  "#4f46e5", // indigo
  "#e11d48", // rose
  "#059669", // emerald
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#0d9488", // teal
  "#ea580c", // orange
  "#2563eb", // blue
];

function YouEditor({ me, takenColors }: { me: Member; takenColors: string[] }) {
  const [name, setName] = useState(me.displayName);
  const [color, setColor] = useState(me.color);
  const [editingName, setEditingName] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (body: { displayName?: string; color?: string }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/members/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      toast.success("Saved");
      // Sidebar avatar + colors across the app come from the server component,
      // so force a refresh.
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const pickColor = (hex: string) => {
    if (hex === color) return;
    setColor(hex);
    save({ color: hex });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Display name</p>
        {editingName ? (
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={busy}
            />
            <Button
              size="sm"
              onClick={async () => {
                if (name.trim() && name !== me.displayName) await save({ displayName: name.trim() });
                else setEditingName(false);
              }}
              disabled={busy}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingName(false);
                setName(me.displayName);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span>{me.displayName}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingName(true)} className="h-7">
              Change
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Display color</p>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((hex) => {
            const taken = takenColors.includes(hex);
            const selected = color === hex;
            return (
              <button
                key={hex}
                type="button"
                onClick={() => !taken && pickColor(hex)}
                disabled={taken || busy}
                aria-label={hex}
                className={`h-8 w-8 rounded-full ring-offset-2 transition-all ${
                  selected ? "ring-2 ring-zinc-900 dark:ring-zinc-50 scale-110" : ""
                } ${taken ? "opacity-30 cursor-not-allowed" : "hover:scale-105"}`}
                style={{ background: hex }}
                title={taken ? "Already taken by your partner" : undefined}
              />
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-500">
          Your color is used for your todos, events, and assignee dots.
        </p>
      </div>
    </div>
  );
}

function IcsAdder({ onAdded }: { onAdded: () => void }) {
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

function AccountRow({
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

function CalendarRow({
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

  return (
    <li className="flex items-center gap-2 py-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm shrink-0"
        style={{ background: cal.color }}
        title={cal.color}
      />
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
              <div className="text-[11px] text-red-500 truncate" title={cal.lastError}>
                ⚠ {cal.lastError}
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
