"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetcher, type Account, type CalendarVM, type Member } from "./types";
import { CategoriesEditor } from "./components/categories";
import { YouEditor } from "./components/you-editor";
import { AccountRow, CalendarRow, IcsAdder } from "./components/calendars";
import { PhotoAlbumEditor } from "./components/photo-album";
import { LinkedAccountsEditor } from "./components/linked-accounts";

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

      <Card id="accounts">
        <CardHeader>
          <CardTitle>Sign-in methods</CardTitle>
        </CardHeader>
        <CardContent>
          <LinkedAccountsEditor />
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
