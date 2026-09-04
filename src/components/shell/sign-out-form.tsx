"use client";

import { useTransition, type ReactNode } from "react";
import { signOutAction } from "@/app/(app)/actions";

// Wraps the sign-out button so that, before the server clears the session,
// the browser drops everything the service worker cached. Otherwise pages
// and API responses stay readable offline on a shared or lost device.
async function clearBrowserCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await Promise.race([
      caches.keys(),
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1500)),
    ]);
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // Best effort — never block sign-out on cache cleanup.
  }
}

export function SignOutForm({ children, className }: { children: ReactNode; className?: string }) {
  const [, startTransition] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm("Sign out?")) return;
        void clearBrowserCaches().then(() => startTransition(() => signOutAction()));
      }}
    >
      {children}
    </form>
  );
}
