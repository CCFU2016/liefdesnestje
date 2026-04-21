"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

  const connectMicrosoft = () => {
    window.location.href = "/api/integrations/microsoft/start";
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
        <CardHeader>
          <CardTitle>Calendar connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {myAccounts.length === 0 ? (
            <p className="text-sm text-zinc-500">No calendars connected yet.</p>
          ) : (
            <ul className="space-y-2">
              {myAccounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="capitalize font-medium">{a.provider}</span> — {a.externalAccountId}
                  </div>
                  <span className="text-xs text-zinc-500">Connected</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-2">
            <Button onClick={connectMicrosoft} variant="secondary">
              Connect Microsoft calendar
            </Button>
            <Button variant="outline" disabled title="Coming soon">
              Connect Google calendar
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            We'll sync your Microsoft 365 calendar both ways. Your partner's calendar (once connected) shows alongside yours.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>You ({me?.displayName})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 text-sm">
            <span className="inline-block h-6 w-6 rounded-full" style={{ background: me?.color }} />
            <span className="text-zinc-500">Display color</span>
          </div>
          {/* TODO(liefdesnestje): allow renaming / changing color */}
        </CardContent>
      </Card>
    </div>
  );
}
