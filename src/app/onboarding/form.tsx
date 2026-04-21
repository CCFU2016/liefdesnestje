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

export function OnboardingForm({
  initialName,
  invite,
}: {
  initialName: string;
  invite: { token: string; householdId: string } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [displayName, setDisplayName] = useState(initialName);
  const [householdName, setHouseholdName] = useState("Our place");
  const [color, setColor] = useState(colors[0].hex);

  const submit = () => {
    start(async () => {
      try {
        const res = await fetch("/api/households", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            displayName,
            color,
            ...(invite ? { inviteToken: invite.token } : { householdName }),
          }),
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
        <CardTitle>
          {invite ? "Join your partner's nest" : "Create your nest"}
        </CardTitle>
        <p className="text-sm text-zinc-500">
          {invite
            ? "You've been invited. Pick a display name and color."
            : "Set up your shared space. You can invite your partner right after."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!invite && (
          <div className="space-y-1.5">
            <Label htmlFor="household">Nest name</Label>
            <Input
              id="household"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              placeholder="Our place"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="name">Your display name</Label>
          <Input
            id="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How should your partner see you?"
          />
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
        </div>
        <Button onClick={submit} disabled={pending || !displayName} className="w-full">
          {pending ? "Setting up…" : invite ? "Join" : "Create"}
        </Button>
      </CardContent>
    </Card>
  );
}
