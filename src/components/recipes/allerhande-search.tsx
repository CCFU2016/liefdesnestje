"use client";

import { useState } from "react";
import { Clock, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Summary = {
  id: number;
  title: string;
  minutes: number | null;
  servings: number | null;
  imageUrl: string | null;
  nutriScore: string | null;
  rating: number | null;
};

export function AllerhandeSearch({
  loading,
  onPick,
  onCancel,
}: {
  loading: boolean;
  onPick: (id: number) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Summary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/recipes/allerhande/search?q=${encodeURIComponent(term)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setResults(body.recipes);
      setTotal(body.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Allerhande</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={search} className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="lasagne, pompoensoep, kip tandoori…"
            disabled={loading}
            autoFocus
          />
          <Button type="submit" disabled={q.trim().length < 2 || searching || loading}>
            <Search className="h-4 w-4" />
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>
        <p className="text-xs text-zinc-500">Albert Heijn&apos;s recipe site, in Dutch. Ingredients, steps and nutrition come over as they are.</p>

        {results && results.length === 0 && <p className="text-sm text-zinc-500">Nothing found. Try another word.</p>}

        {results && results.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onPick(r.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 p-2 text-left hover:border-zinc-400 disabled:opacity-60 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" loading="lazy" />
                  ) : (
                    <div className="h-16 w-16 shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-900" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      {r.minutes != null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {r.minutes} min
                        </span>
                      )}
                      {r.servings != null && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {r.servings}
                        </span>
                      )}
                      {r.nutriScore && <span>Nutri-Score {r.nutriScore}</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {results && total > results.length && (
          <p className="text-xs text-zinc-500">Showing the first {results.length} of {total}. Narrow the search to see others.</p>
        )}

        <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}
