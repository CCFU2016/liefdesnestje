"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const colors = [
  { hex: "#4f46e5", name: "Indigo" },
  { hex: "#e11d48", name: "Rose" },
  { hex: "#059669", name: "Emerald" },
  { hex: "#d97706", name: "Amber" },
  { hex: "#7c3aed", name: "Violet" },
  { hex: "#0891b2", name: "Cyan" },
];

export function SwitchForm({
  canSwitch,
  inviteToken,
  currentDisplayName,
  currentColor,
}: {
  canSwitch: boolean;
  inviteToken: string;
  currentDisplayName: string;
  currentColor: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [color, setColor] = useState(currentColor);
  const [confirmed, setConfirmed] = useState(false);

  if (!canSwitch) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Can&apos;t switch — you share a household</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">
            You&apos;re already in a household that has another member. To accept this invite you&apos;d first
            have to remove the other person from your current household — or they&apos;d have to remove you.
          </p>
          <p className="text-xs text-zinc-500">
            If you think that&apos;s a mistake, ask whoever invited you to regenerate the link after the
            other situation is sorted.
          </p>
        </CardContent>
      </Card>
    );
  }

  const submit = () => {
    start(async () => {
      try {
        const res = await fetch("/api/households/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inviteToken, displayName, color }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Something went wrong");
        }
        router.push("/today");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join your partner&apos;s nest</CardTitle>
        <p className="text-sm text-zinc-500">
          You&apos;re currently in your own household. Accepting this invite will replace it with your
          partner&apos;s.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200">
          <strong>Heads up:</strong> any todos, notes, events or trips you created in your current
          (solo) household will be deleted. Nothing in your Outlook / Google Calendar is touched.
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>Your color</Label>
          <div className="flex gap-2 flex-wrap">
            {colors.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setColor(c.hex)}
                aria-label={c.name}
                className={`h-9 w-9 rounded-full ring-offset-2 transition-all ${
                  color === c.hex ? "ring-2 ring-zinc-900 dark:ring-zinc-50 scale-110" : ""
                }`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
          <p className="text-[11px] text-zinc-500">
            If your partner&apos;s using that same color, we&apos;ll reject it and you can pick another.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>I understand my current solo nest and its data will be deleted.</span>
        </label>

        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending || !displayName || !confirmed} className="flex-1">
            {pending ? "Switching…" : "Switch to my partner's nest"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
