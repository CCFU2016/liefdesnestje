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

      <Card id="categories">
        <CardHeader>
          <CardTitle>Event categories</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoriesEditor />
        </CardContent>
      </Card>

      <Card id="photo-album">
        <CardHeader>
          <CardTitle>Photo of the day</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoAlbumEditor />
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

type EventCategoryVM = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

function CategoriesEditor() {
  const { data, mutate } = useSWR<{ categories: EventCategoryVM[] }>(
    "/api/event-categories",
    fetcher
  );
  const categories = data?.categories ?? [];
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/event-categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, color: newColor }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      setNewName("");
      setNewColor(null);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        Categories tag the items on the Events page. Default set is {`"holidays"`} and {`"events"`}.
        Add more to fit your life.
      </p>
      <ul className="space-y-1.5">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} onChanged={() => mutate()} />
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="flex flex-wrap gap-2 items-center border-t border-zinc-200 dark:border-zinc-800 pt-3"
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 min-w-[140px]"
        />
        <div className="flex items-center gap-1">
          {PRESET_COLORS.slice(0, 8).map((hex) => (
            <button
              key={hex}
              type="button"
              className={`h-5 w-5 rounded-full ring-offset-1 ${
                newColor === hex ? "ring-2 ring-zinc-900 dark:ring-zinc-50" : ""
              }`}
              style={{ background: hex }}
              onClick={() => setNewColor(newColor === hex ? null : hex)}
              aria-label={hex}
            />
          ))}
        </div>
        <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function CategoryRow({
  category,
  onChanged,
}: {
  category: EventCategoryVM;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);

  const patch = async (body: { name?: string; color?: string | null }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/event-categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const next = name.trim().toLowerCase();
    if (!next || next === category.name) {
      setEditing(false);
      setName(category.name);
      return;
    }
    await patch({ name: next });
    setEditing(false);
  };

  const remove = async () => {
    if (
      !confirm(
        `Remove the "${category.name}" category? Events in this category will become uncategorized (they stay).`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/event-categories/${category.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const cycleColor = () => {
    const idx = category.color ? PRESET_COLORS.indexOf(category.color) : -1;
    const next = idx === -1 ? PRESET_COLORS[0] : PRESET_COLORS[(idx + 1) % PRESET_COLORS.length];
    patch({ color: next });
  };

  return (
    <li className="flex items-center gap-2 text-sm">
      <button
        onClick={cycleColor}
        disabled={busy}
        className="h-4 w-4 rounded-full shrink-0 ring-1 ring-zinc-200 dark:ring-zinc-700"
        style={{ background: category.color ?? "transparent" }}
        title="Cycle color"
      />
      {editing ? (
        <div className="flex-1 flex gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") {
                setEditing(false);
                setName(category.name);
              }
            }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveName} disabled={busy}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setEditing(false);
              setName(category.name);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <span className="flex-1">{category.name}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)} title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-zinc-500 hover:text-red-500"
            onClick={remove}
            disabled={busy}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </li>
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

// Same palette, aliased for clarity at the CalendarRow call site.
const CALENDAR_COLOR_PRESETS = PRESET_COLORS;

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

type PhotoAlbumVM = {
  shareUrl: string;
  streamName: string | null;
  lastError: string | null;
  lastSyncedAt: string | Date | null;
};

function PhotoAlbumEditor() {
  const { data, mutate, isLoading } = useSWR<{ album: PhotoAlbumVM | null }>(
    "/api/settings/photo-album",
    fetcher
  );
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const album = data?.album ?? null;

  const save = async () => {
    const v = input.trim();
    if (!v) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/photo-album", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareUrl: v }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed");
      }
      const body = (await res.json()) as { streamName: string | null; photoCount: number };
      toast.success(
        body.streamName
          ? `Linked "${body.streamName}" (${body.photoCount} photo${body.photoCount === 1 ? "" : "s"})`
          : `Linked (${body.photoCount} photos)`
      );
      setInput("");
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect the photo album? The Today page stops showing a daily photo.")) return;
    try {
      await fetch("/api/settings/photo-album", { method: "DELETE" });
      mutate();
      toast.success("Disconnected.");
    } catch {
      toast.error("Failed to disconnect.");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Share an album publicly from Photos.app (Share → Public Website → copy link) and paste the
        URL here. We pick a random photo from it every day and show it on Today.
      </p>
      <p className="text-[11px] text-zinc-500">
        Note: this uses the same public endpoint Apple&apos;s own share viewer uses. It&apos;s not an
        official API, so if Apple changes it this may break.
      </p>

      {isLoading ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : album ? (
        <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="font-medium">{album.streamName ?? "Shared album"}</div>
          <div className="text-xs text-zinc-500 truncate" title={album.shareUrl}>
            {album.shareUrl}
          </div>
          {album.lastError && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">{album.lastError}</div>
          )}
          {album.lastSyncedAt && (
            <div className="mt-1 text-[11px] text-zinc-500">
              Last synced {new Date(album.lastSyncedAt).toLocaleString()}
            </div>
          )}
          <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://www.icloud.com/sharedalbum/#…"
        />
        <Button onClick={save} disabled={saving || !input.trim()}>
          {saving ? "Checking…" : album ? "Replace" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
