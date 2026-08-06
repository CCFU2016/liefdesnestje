"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetcher } from "../types";

type PhotoAlbumVM = {
  shareUrl: string;
  streamName: string | null;
  lastError: string | null;
  lastSyncedAt: string | Date | null;
};

export function PhotoAlbumEditor() {
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

