"use client";

// Placeholder — fully built in Sprint 2 (Microsoft Graph two-way sync).
// TODO(liefdesnestje): replace with react-big-calendar view + event CRUD.

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CalendarVM = {
  id: string;
  accountId: string;
  name: string;
  color: string;
  syncEnabled: boolean;
};

type AccountVM = {
  id: string;
  userId: string;
  provider: "google" | "microsoft";
  externalAccountId: string;
};

export function CalendarShell({
  members,
  accounts,
  calendars,
}: {
  members: { userId: string; displayName: string; color: string }[];
  accounts: AccountVM[];
  calendars: CalendarVM[];
}) {
  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 md:p-10">
        <Card>
          <CardHeader>
            <CardTitle>Connect a calendar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-zinc-500">
              Link your Microsoft 365 calendar to see your events here and have Liefdesnestje sync both ways.
            </p>
            <Button onClick={() => (window.location.href = "/api/integrations/microsoft/start")}>
              Connect Microsoft calendar
            </Button>
            <p className="text-xs text-zinc-500">
              Google Calendar sync is coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="flex gap-6">
        <aside className="hidden md:block w-56 shrink-0">
          <h3 className="text-sm font-semibold mb-2">Calendars</h3>
          <ul className="space-y-1 text-sm">
            {calendars.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: c.color }} />
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-semibold mt-6 mb-2">Nest members</h3>
          <ul className="space-y-1 text-sm">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: m.color }} />
                <span>{m.displayName}</span>
              </li>
            ))}
          </ul>
        </aside>
        <div className="flex-1">
          <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">
            Calendar grid will render here once Sprint 2 is in.
            <br />
            {calendars.length} calendar{calendars.length === 1 ? "" : "s"} connected.
          </div>
        </div>
      </div>
    </div>
  );
}
