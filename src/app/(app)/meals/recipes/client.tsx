"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Plus, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RecipeRow = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  tags: string[];
  imageUrl: string | null;
  cookedCount: number;
  authorId: string;
  visibility: "private" | "shared";
  updatedAt: string | Date;
  isFavorite: boolean;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function RecipesClient({ initialRecipes }: { initialRecipes: RecipeRow[] }) {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const key = `/api/recipes${favoritesOnly ? "?favorites=1" : ""}`;
  const { data, mutate } = useSWR<{ recipes: RecipeRow[] }>(key, fetcher, {
    fallbackData: { recipes: initialRecipes },
  });
  const all = data?.recipes ?? initialRecipes;

  const filtered = useMemo(() => {
    return all.filter((r) => {
      if (query && !r.title.toLowerCase().includes(query.toLowerCase())) return false;
      if (activeTag && !r.tags.includes(activeTag)) return false;
      return true;
    });
  }, [all, query, activeTag]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const r of all) for (const t of r.tags) s.add(t);
    return Array.from(s).sort();
  }, [all]);

  const toggleFavorite = async (r: RecipeRow) => {
    mutate(
      (prev) => ({
        recipes: (prev?.recipes ?? []).map((x) =>
          x.id === r.id ? { ...x, isFavorite: !x.isFavorite } : x
        ),
      }),
      false
    );
    try {
      await fetch(`/api/recipes/${r.id}/favorite`, { method: r.isFavorite ? "DELETE" : "POST" });
      mutate();
    } catch {
      toast.error("Couldn't update favorite");
      mutate();
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-2xl font-semibold">Recipes</h1>
        <Link href="/meals/recipes/new">
          <Button>
            <Plus className="h-4 w-4" /> New recipe
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
          />
        </div>
        <Button
          size="sm"
          variant={favoritesOnly ? "secondary" : "ghost"}
          onClick={() => setFavoritesOnly((v) => !v)}
          className="gap-1.5"
        >
          <Star className={`h-3.5 w-3.5 ${favoritesOnly ? "fill-amber-500 text-amber-500" : ""}`} />
          Favorites
        </Button>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-4">
          <button
            onClick={() => setActiveTag(null)}
            className={`text-xs px-2 py-0.5 rounded-full ${
              activeTag === null
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "bg-zinc-100 dark:bg-zinc-800"
            }`}
          >
            all
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`text-xs px-2 py-0.5 rounded-full ${
                activeTag === t
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">
          {all.length === 0 ? (
            <>
              No recipes yet.{" "}
              <Link href="/meals/recipes/new" className="underline">Add your first one</Link>.
            </>
          ) : (
            "Nothing matches that filter."
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <li key={r.id} className="relative">
              <Link
                href={`/meals/recipes/${r.id}`}
                className="block rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
              >
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt="" className="h-40 w-full object-cover" />
                ) : (
                  <div className="h-40 bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900" />
                )}
                <div className="p-3">
                  <div className="font-medium truncate">{r.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {r.servings} serv
                    {r.cookTimeMinutes != null && ` · ${r.cookTimeMinutes} min`}
                    {r.cookedCount > 0 && ` · cooked ${r.cookedCount}×`}
                    {r.visibility === "private" && " · private"}
                  </div>
                </div>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  toggleFavorite(r);
                }}
                className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur bg-white/80 dark:bg-zinc-950/80 ${
                  r.isFavorite ? "text-amber-500" : "text-zinc-400 hover:text-zinc-700"
                }`}
                aria-label={r.isFavorite ? "Unfavorite" : "Favorite"}
              >
                <Star className={`h-3.5 w-3.5 ${r.isFavorite ? "fill-amber-500" : ""}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
