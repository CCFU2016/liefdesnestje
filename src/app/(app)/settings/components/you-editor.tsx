"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRESET_COLORS, type Member } from "../types";

export function YouEditor({ me, takenColors }: { me: Member; takenColors: string[] }) {
  const [name, setName] = useState(me.displayName);
  const [color, setColor] = useState(me.color);
  const [editingName, setEditingName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me.avatarUrl ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const uploadAvatar = async (file: File) => {
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/me/avatar", { method: "POST", body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Upload failed");
      }
      const data = (await res.json()) as { avatarUrl: string };
      setAvatarUrl(data.avatarUrl);
      toast.success("Avatar updated.");
      // Sidebar avatar reads from the server component too — refresh.
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (!confirm("Remove avatar and go back to the colored circle?")) return;
    setAvatarBusy(true);
    try {
      await fetch("/api/me/avatar", { method: "DELETE" });
      setAvatarUrl(null);
      setTimeout(() => window.location.reload(), 300);
    } finally {
      setAvatarBusy(false);
    }
  };

  const save = async (body: { displayName?: string; color?: string }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/members/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      toast.success("Saved");
      // Sidebar avatar + colors across the app come from the server component,
      // so force a refresh.
      setTimeout(() => window.location.reload(), 300);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const pickColor = (hex: string) => {
    if (hex === color) return;
    setColor(hex);
    save({ color: hex });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Avatar</p>
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <span
              className="inline-block h-12 w-12 rounded-full"
              style={{ background: color }}
              aria-label="No avatar — using your color"
            />
          )}
          <label className="inline-flex">
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                e.target.value = "";
              }}
              disabled={avatarBusy}
            />
            <span
              className={`inline-flex items-center justify-center h-9 px-3 rounded-md border border-zinc-200 bg-white text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 cursor-pointer ${avatarBusy ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {avatarBusy ? "Uploading…" : avatarUrl ? "Replace" : "Upload"}
            </span>
          </label>
          {avatarUrl && (
            <Button size="sm" variant="ghost" onClick={removeAvatar} disabled={avatarBusy}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-[11px] text-zinc-500">
          JPEG, PNG, GIF, or WebP. Falls back to your colored circle when no avatar is set.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Display name</p>
        {editingName ? (
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={busy}
            />
            <Button
              size="sm"
              onClick={async () => {
                if (name.trim() && name !== me.displayName) await save({ displayName: name.trim() });
                else setEditingName(false);
              }}
              disabled={busy}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditingName(false);
                setName(me.displayName);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span>{me.displayName}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingName(true)} className="h-7">
              Change
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Display color</p>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((hex) => {
            const taken = takenColors.includes(hex);
            const selected = color === hex;
            return (
              <button
                key={hex}
                type="button"
                onClick={() => !taken && pickColor(hex)}
                disabled={taken || busy}
                aria-label={hex}
                className={`h-8 w-8 rounded-full ring-offset-2 transition-all ${
                  selected ? "ring-2 ring-zinc-900 dark:ring-zinc-50 scale-110" : ""
                } ${taken ? "opacity-30 cursor-not-allowed" : "hover:scale-105"}`}
                style={{ background: hex }}
                title={taken ? "Already taken by your partner" : undefined}
              />
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-500">
          Your color is used for your todos, events, and assignee dots.
        </p>
      </div>
    </div>
  );
}

