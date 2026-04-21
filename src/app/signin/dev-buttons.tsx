"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DevSignInButtons() {
  const [pending, setPending] = useState<"niki" | "partner" | null>(null);

  const signIn = async (as: "niki" | "partner") => {
    setPending(as);
    try {
      const res = await fetch("/api/dev/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ as }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Dev sign-in failed");
      }
      window.location.href = "/";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dev sign-in failed");
      setPending(null);
    }
  };

  return (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        className="flex-1"
        onClick={() => signIn("niki")}
        disabled={!!pending}
      >
        {pending === "niki" ? "…" : "Sign in as Niki"}
      </Button>
      <Button
        variant="secondary"
        className="flex-1"
        onClick={() => signIn("partner")}
        disabled={!!pending}
      >
        {pending === "partner" ? "…" : "Sign in as Partner"}
      </Button>
    </div>
  );
}
