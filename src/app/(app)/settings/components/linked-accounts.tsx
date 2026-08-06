"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetcher } from "../types";

type LinkedAccount = {
  provider: "google";
  providerAccountId: string;
  email: string | null;
};

export function LinkedAccountsEditor() {
  const { data, mutate, isLoading } = useSWR<{ accounts: LinkedAccount[] }>(
    "/api/auth/linked-accounts",
    fetcher
  );
  const linked = data?.accounts ?? [];
  const [justLinked, setJustLinked] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flash = params.get("linked");
    if (!flash) return;
    // Clean the URL so a refresh doesn't re-fire the toast.
    params.delete("linked");
    const next = window.location.pathname + (params.toString() ? `?${params}` : "") + "#accounts";
    window.history.replaceState(null, "", next);
    switch (flash) {
      case "ok":
        toast.success("Linked the second Google account. Sign in with either from now on.");
        setJustLinked(true);
        mutate();
        break;
      case "already":
        toast.info("That Google account was already linked.");
        setJustLinked(true);
        break;
      case "in_use":
        setConflict(true);
        break;
      case "bad_state":
        toast.error("Couldn't verify the link request — try again.");
        break;
      case "token_failed":
      case "no_id_token":
      case "no_subject":
        toast.error("Google didn't return a valid token.");
        break;
      case "not_configured":
        toast.error("Google OAuth isn't configured on the server.");
        break;
      default:
        toast.error(`Link failed: ${flash}`);
    }
  }, [mutate]);

  const unlink = async (providerAccountId: string) => {
    if (!confirm("Unlink this Google account? You'll no longer be able to sign in with it.")) return;
    try {
      const res = await fetch("/api/auth/linked-accounts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerAccountId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Unlink failed");
      }
      mutate();
      toast.success("Unlinked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlink failed");
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Link a second Google account (e.g. personal + work) so either one can sign in to the same
        profile. All linked accounts grant full access — only add accounts you control.
      </p>

      {justLinked && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          ✓ Linking completed. You can now sign in with any Google account listed below.
        </div>
      )}

      {conflict && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="font-medium">That Google account already owns a separate profile.</div>
          <p className="mt-1">
            It&apos;s currently attached to a different user with household data. You can link it
            anyway — but doing so will <strong>permanently delete that other profile</strong> and
            everything it owns (calendars, todos, recipes, etc.).
          </p>
          <div className="mt-2 flex gap-2">
            {/* OAuth kickoff needs a full-page navigation to the route handler —
                <Link/> client-side nav would break the redirect to Google. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/auth/link-google?force=1"
              onClick={(e) => {
                if (
                  !confirm(
                    "This will permanently delete the other profile that owns this Google account, including any households, events, and recipes attached to it. Continue?"
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                Yes, replace the other profile
              </Button>
            </a>
            <Button size="sm" variant="ghost" onClick={() => setConflict(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : (
        <>
          <div className="text-xs text-zinc-500">
            {linked.length} Google account{linked.length === 1 ? "" : "s"} connected
          </div>
          <ul className="space-y-2">
            {linked.map((a) => (
            <li
              key={a.providerAccountId}
              className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800"
            >
              <div className="min-w-0">
                <div className="font-medium">Google</div>
                <div className="text-xs text-zinc-500 truncate">
                  {a.email ?? `Account ${a.providerAccountId.slice(0, 8)}…`}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => unlink(a.providerAccountId)}
                disabled={linked.length <= 1}
                className="text-zinc-500 hover:text-red-500"
                title={linked.length <= 1 ? "Can't remove your last sign-in method" : "Unlink"}
              >
                Unlink
              </Button>
            </li>
          ))}
          </ul>
        </>
      )}
      <div>
        {/* OAuth kickoff needs a full-page navigation to the route handler —
            <Link/> client-side nav would break the redirect to Google. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/auth/link-google">
          <Button size="sm">Link another Google account</Button>
        </a>
      </div>
    </div>
  );
}
