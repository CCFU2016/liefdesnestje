"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink, Plus, Sparkles, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as Dialog from "@radix-ui/react-dialog";

type Member = { userId: string; displayName: string; color: string; avatarUrl?: string | null };

type Category = { id: string; name: string; sortOrder: number };

type ItemLink = { url: string; label?: string };

type Item = {
  id: string;
  title: string;
  notes: string | null;
  links: ItemLink[];
  categoryId: string | null;
  authorId: string;
  completedAt: string | null;
  stars: { userId: string; stars: number }[];
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function BucketListClient({
  members,
  initialCategories,
  currentUserId,
}: {
  members: Member[];
  initialCategories: Category[];
  currentUserId: string;
}) {
  const { data, mutate } = useSWR<{ items: Item[] }>("/api/bucket-list/items", fetcher, {
    refreshInterval: 10000,
  });
  const { data: catData, mutate: mutateCategories } = useSWR<{ categories: Category[] }>(
    "/api/bucket-list/categories",
    fetcher,
    { fallbackData: { categories: initialCategories } }
  );

  const items = useMemo(() => data?.items ?? [], [data]);
  const categories = catData?.categories ?? initialCategories;

  const [filter, setFilter] = useState<string | null | "uncategorized">(null);
  const [dialog, setDialog] = useState<{ existing?: Item } | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);

  const filtered = useMemo(() => {
    let list = items;
    if (filter === "uncategorized") list = list.filter((i) => !i.categoryId);
    else if (filter) list = list.filter((i) => i.categoryId === filter);
    // Open dreams first (by combined stars, most-wanted on top), done ones last.
    const score = (i: Item) => i.stars.reduce((sum, s) => sum + s.stars, 0);
    return [...list].sort((a, b) => {
      if (!!a.completedAt !== !!b.completedAt) return a.completedAt ? 1 : -1;
      return score(b) - score(a);
    });
  }, [items, filter]);

  const hasUncategorized = items.some((i) => !i.categoryId);

  const rate = async (item: Item, stars: number) => {
    const mine = item.stars.find((s) => s.userId === currentUserId)?.stars ?? 0;
    const clearing = mine === stars;
    mutate(
      (prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === item.id
            ? {
                ...i,
                stars: [
                  ...i.stars.filter((s) => s.userId !== currentUserId),
                  ...(clearing ? [] : [{ userId: currentUserId, stars }]),
                ],
              }
            : i
        ),
      }),
      false
    );
    try {
      const res = await fetch(`/api/bucket-list/items/${item.id}/stars`, {
        method: clearing ? "DELETE" : "PUT",
        headers: { "content-type": "application/json" },
        body: clearing ? undefined : JSON.stringify({ stars }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save your rating — try again.");
    }
    mutate();
  };

  const toggleDone = async (item: Item) => {
    const completed = !item.completedAt;
    mutate(
      (prev) => ({
        items: (prev?.items ?? []).map((i) =>
          i.id === item.id ? { ...i, completedAt: completed ? new Date().toISOString() : null } : i
        ),
      }),
      false
    );
    try {
      const res = await fetch(`/api/bucket-list/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error();
      if (completed) toast.success("Ticked off the list! 🎉");
    } catch {
      toast.error("Couldn't update — try again.");
    }
    mutate();
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" /> Bucket list
        </h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setManagingCategories(true)}>
            Categories
          </Button>
          <Button onClick={() => setDialog({})} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <FilterChip label="All" active={filter === null} onClick={() => setFilter(null)} />
        {categories.map((c) => (
          <FilterChip
            key={c.id}
            label={c.name}
            active={filter === c.id}
            onClick={() => setFilter(filter === c.id ? null : c.id)}
          />
        ))}
        {hasUncategorized && (
          <FilterChip
            label="Uncategorized"
            active={filter === "uncategorized"}
            onClick={() => setFilter(filter === "uncategorized" ? null : "uncategorized")}
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-zinc-500">
            Nothing here yet — add your first dream with the button above.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              members={members}
              currentUserId={currentUserId}
              category={categories.find((c) => c.id === item.categoryId) ?? null}
              onRate={(stars) => rate(item, stars)}
              onToggleDone={() => toggleDone(item)}
              onEdit={() => setDialog({ existing: item })}
            />
          ))}
        </ul>
      )}

      {dialog && (
        <ItemDialog
          existing={dialog.existing}
          categories={categories}
          defaultCategoryId={typeof filter === "string" && filter !== "uncategorized" ? filter : null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            mutate();
          }}
        />
      )}

      {managingCategories && (
        <CategoriesDialog
          categories={categories}
          onClose={() => setManagingCategories(false)}
          onChanged={() => {
            mutateCategories();
            mutate();
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-1 text-xs transition-colors " +
        (active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400")
      }
    >
      {label}
    </button>
  );
}

function StarRow({
  value,
  onSelect,
  color,
  interactive,
}: {
  value: number;
  onSelect?: (stars: number) => void;
  color?: string;
  interactive: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!interactive}
          onClick={() => onSelect?.(n)}
          className={interactive ? "cursor-pointer" : "cursor-default"}
          aria-label={interactive ? `Rate ${n} star${n > 1 ? "s" : ""}` : undefined}
        >
          <Star
            className={"h-4 w-4 " + (n <= value ? "" : "opacity-25")}
            style={{ color: color ?? "rgb(245 158 11)" }}
            fill={n <= value ? (color ?? "rgb(245 158 11)") : "none"}
          />
        </button>
      ))}
    </span>
  );
}

function ItemCard({
  item,
  members,
  currentUserId,
  category,
  onRate,
  onToggleDone,
  onEdit,
}: {
  item: Item;
  members: Member[];
  currentUserId: string;
  category: Category | null;
  onRate: (stars: number) => void;
  onToggleDone: () => void;
  onEdit: () => void;
}) {
  const done = !!item.completedAt;
  const partner = members.filter((m) => m.userId !== currentUserId);
  const myStars = item.stars.find((s) => s.userId === currentUserId)?.stars ?? 0;

  return (
    <li>
      <Card className={done ? "opacity-60" : ""}>
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={done}
              onChange={onToggleDone}
              className="mt-1"
              title={done ? "Put it back on the list" : "Tick it off!"}
            />
            <div className="flex-1 min-w-0">
              <button
                onClick={onEdit}
                className={
                  "text-left text-sm font-medium hover:underline " + (done ? "line-through" : "")
                }
              >
                {item.title}
              </button>
              {category && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  {category.name}
                </span>
              )}
              {item.notes && (
                <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2 whitespace-pre-wrap">
                  {item.notes}
                </p>
              )}
              {item.links.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {item.links.map((l, i) => (
                    <a
                      key={i}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {l.label || hostOf(l.url)}
                    </a>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  You
                  <StarRow value={myStars} onSelect={onRate} interactive={!done} />
                </span>
                {partner.map((m) => {
                  const theirs = item.stars.find((s) => s.userId === m.userId)?.stars ?? 0;
                  return (
                    <span key={m.userId} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                      {m.displayName}
                      <StarRow value={theirs} color={m.color} interactive={false} />
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ItemDialog({
  existing,
  categories,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  existing?: Item;
  categories: Category[];
  defaultCategoryId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [categoryId, setCategoryId] = useState<string | "">(
    existing ? (existing.categoryId ?? "") : (defaultCategoryId ?? "")
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [links, setLinks] = useState<ItemLink[]>(existing?.links ?? []);
  const [newLink, setNewLink] = useState("");
  const [busy, setBusy] = useState(false);

  const addLink = () => {
    const url = newLink.trim();
    if (!url) return;
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      new URL(withScheme);
    } catch {
      toast.error("That doesn't look like a link.");
      return;
    }
    setLinks([...links, { url: withScheme }]);
    setNewLink("");
  };

  const save = async () => {
    if (!title.trim()) return toast.error("A title is required.");
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        categoryId: categoryId || null,
        notes: notes.trim() || null,
        links,
      };
      const res = existing
        ? await fetch(`/api/bucket-list/items/${existing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/bucket-list/items", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      toast.success(existing ? "Saved" : "Added to the list ✨");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm(`Remove "${existing.title}" from the bucket list?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bucket-list/items/${existing.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Removed");
      onSaved();
    } catch {
      toast.error("Delete failed");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-semibold">
            {existing ? "Edit item" : "New bucket list item"}
          </Dialog.Title>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bl-title">What&apos;s the dream?</Label>
              <Input
                id="bl-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="See the northern lights"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bl-category">Category</Label>
              <select
                id="bl-category"
                className="w-full h-9 rounded-md border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-800"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bl-notes">Notes</Label>
              <textarea
                id="bl-notes"
                className="w-full min-h-20 rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Best in winter, from Tromsø or Iceland…"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bl-link">Links</Label>
              {links.length > 0 && (
                <ul className="space-y-1">
                  {links.map((l, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
                      <span className="truncate flex-1">{l.label || l.url}</span>
                      <button
                        onClick={() => setLinks(links.filter((_, j) => j !== i))}
                        className="text-zinc-400 hover:text-red-500"
                        aria-label="Remove link"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  id="bl-link"
                  value={newLink}
                  onChange={(e) => setNewLink(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLink();
                    }
                  }}
                  placeholder="https://…"
                />
                <Button type="button" variant="secondary" onClick={addLink}>
                  Add
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <div>
              {existing && (
                <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Saving…" : existing ? "Save" : "Add"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CategoriesDialog({
  categories,
  onClose,
  onChanged,
}: {
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/bucket-list/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Create failed");
      setNewName("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Category) => {
    if (
      !confirm(
        `Delete "${c.name}"? Items in it are kept and become uncategorized.`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bucket-list/categories/${c.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      toast.error("Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <Dialog.Title className="text-lg font-semibold">Categories</Dialog.Title>

          <ul className="mt-4 space-y-1">
            {categories.length === 0 && (
              <li className="text-sm text-zinc-500">None yet — add one below.</li>
            )}
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm py-1">
                <span className="flex-1">{c.name}</span>
                <button
                  onClick={() => remove(c)}
                  disabled={busy}
                  className="text-zinc-400 hover:text-red-500"
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="travel, movies to watch…"
            />
            <Button onClick={add} disabled={busy}>
              Add
            </Button>
          </div>

          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
