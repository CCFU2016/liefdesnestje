"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetcher, PRESET_COLORS } from "../types";

type EventCategoryVM = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

export function CategoriesEditor() {
  const { data, mutate } = useSWR<{ categories: EventCategoryVM[] }>(
    "/api/event-categories",
    fetcher
  );
  const categories = data?.categories ?? [];
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/event-categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, color: newColor }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      setNewName("");
      setNewColor(null);
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        Categories tag the items on the Events page. Default set is {`"holidays"`} and {`"events"`}.
        Add more to fit your life.
      </p>
      <ul className="space-y-1.5">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} onChanged={() => mutate()} />
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="flex flex-wrap gap-2 items-center border-t border-zinc-200 dark:border-zinc-800 pt-3"
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 min-w-[140px]"
        />
        <div className="flex items-center gap-1">
          {PRESET_COLORS.slice(0, 8).map((hex) => (
            <button
              key={hex}
              type="button"
              className={`h-5 w-5 rounded-full ring-offset-1 ${
                newColor === hex ? "ring-2 ring-zinc-900 dark:ring-zinc-50" : ""
              }`}
              style={{ background: hex }}
              onClick={() => setNewColor(newColor === hex ? null : hex)}
              aria-label={hex}
            />
          ))}
        </div>
        <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

function CategoryRow({
  category,
  onChanged,
}: {
  category: EventCategoryVM;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);

  const patch = async (body: { name?: string; color?: string | null }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/event-categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const next = name.trim().toLowerCase();
    if (!next || next === category.name) {
      setEditing(false);
      setName(category.name);
      return;
    }
    await patch({ name: next });
    setEditing(false);
  };

  const remove = async () => {
    if (
      !confirm(
        `Remove the "${category.name}" category? Events in this category will become uncategorized (they stay).`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/event-categories/${category.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const cycleColor = () => {
    const idx = category.color ? PRESET_COLORS.indexOf(category.color) : -1;
    const next = idx === -1 ? PRESET_COLORS[0] : PRESET_COLORS[(idx + 1) % PRESET_COLORS.length];
    patch({ color: next });
  };

  return (
    <li className="flex items-center gap-2 text-sm">
      <button
        onClick={cycleColor}
        disabled={busy}
        className="h-4 w-4 rounded-full shrink-0 ring-1 ring-zinc-200 dark:ring-zinc-700"
        style={{ background: category.color ?? "transparent" }}
        title="Cycle color"
      />
      {editing ? (
        <div className="flex-1 flex gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") {
                setEditing(false);
                setName(category.name);
              }
            }}
          />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveName} disabled={busy}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              setEditing(false);
              setName(category.name);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <span className="flex-1">{category.name}</span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)} title="Rename">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-zinc-500 hover:text-red-500"
            onClick={remove}
            disabled={busy}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </li>
  );
}
