"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetcher } from "../types";

type Status = {
  connected: boolean;
  needsReconnect: boolean;
  connectedByName: string | null;
  connectedByMe: boolean;
  canManage: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
  loginUrl: string;
};

function relative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function AlbertHeijnCard() {
  const { data, mutate, isLoading } = useSWR<Status>("/api/integrations/albert-heijn/status", fetcher);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/albert-heijn/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't connect");
      toast.success("Albert Heijn connected");
      setCode("");
      setShowHowTo(false);
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Albert Heijn?\n\nSending groceries to the Appie app stops working until someone connects it again. Nothing changes in your Albert Heijn account.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/albert-heijn/disconnect", { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Disconnected");
      mutate();
    } catch {
      toast.error("Couldn't disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !data) return <p className="text-sm text-zinc-500">Checking…</p>;

  const needsAction = !data.connected || data.needsReconnect;
  const statusLine = !data.connected
    ? "Not connected"
    : data.needsReconnect
      ? "Needs renewing"
      : `Connected${data.connectedByName ? ` by ${data.connectedByName}` : ""} · last used ${relative(data.lastUsedAt)}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-block h-2.5 w-2.5 rounded-full " +
              (!data.connected ? "bg-zinc-300 dark:bg-zinc-700" : data.needsReconnect ? "bg-amber-500" : "bg-emerald-500")
            }
          />
          <span>{statusLine}</span>
        </div>
        {data.connected && data.canManage && (
          <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        )}
      </div>

      {data.connected && !data.needsReconnect && (
        <p className="text-[11px] text-zinc-500">
          Groceries you send from the meal plan land in Mijn lijst in the Appie app. Ticking off and removing happens there.
        </p>
      )}

      {needsAction && !data.canManage && (
        <p className="text-sm text-zinc-500">
          Ask {data.connectedByName ?? "the person who connected it"} to {data.needsReconnect ? "renew" : "set up"} the Albert Heijn connection.
        </p>
      )}

      {needsAction && data.canManage && !showHowTo && (
        <Button variant="secondary" onClick={() => setShowHowTo(true)}>
          {data.needsReconnect ? "Renew Albert Heijn connection" : "Connect Albert Heijn"}
        </Button>
      )}

      {needsAction && data.canManage && showHowTo && (
        <form onSubmit={connect} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              On a laptop, open{" "}
              <a href={data.loginUrl} target="_blank" rel="noreferrer" className="underline">
                the Albert Heijn login page
              </a>{" "}
              and sign in with your own AH account.
            </li>
            <li>
              After signing in the page tries to open a link that starts with <code className="text-xs">appie://login-exit</code> and
              fails. Copy that whole link from the address bar.
            </li>
            <li>Paste it below within a couple of minutes.</li>
          </ol>
          <Input
            placeholder="appie://login-exit?code=…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !code.trim()}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowHowTo(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] text-zinc-500">
            One connection per nest, on one AH account. Your partner never has to log in.
          </p>
        </form>
      )}
    </div>
  );
}
