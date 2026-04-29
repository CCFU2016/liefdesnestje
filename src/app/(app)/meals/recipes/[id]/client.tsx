"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarPlus, ChefHat, Edit, ExternalLink, Sparkles, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Ingredient = { quantity: string | null; unit: string | null; name: string; notes: string | null };
type Recipe = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  ingredients: Ingredient[];
  instructions: string[];
  tags: string[];
  nutritionPerServing: {
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    fiber: number | null;
  } | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  cookedCount: number;
  score: number | null;
  visibility: "private" | "shared";
  authorId: string;
};

export function RecipeDetailClient({
  recipe: initialRecipe,
  isFavorite: initialFav,
  canEdit,
}: {
  recipe: Recipe;
  isFavorite: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [recipe, setRecipe] = useState(initialRecipe);
  const [fav, setFav] = useState(initialFav);
  const [busy, setBusy] = useState(false);

  const toggleFavorite = async () => {
    setFav(!fav);
    await fetch(`/api/recipes/${recipe.id}/favorite`, { method: fav ? "DELETE" : "POST" });
  };

  const setScore = async (n: number | null) => {
    const prev = recipe.score;
    setRecipe({ ...recipe, score: n });
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ score: n }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRecipe({ ...recipe, score: prev });
      toast.error("Couldn't save the score.");
    }
  };

  const [planDialog, setPlanDialog] = useState(false);
  const [estimatingNutrition, setEstimatingNutrition] = useState(false);
  const estimateMacros = async () => {
    setEstimatingNutrition(true);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}/estimate-nutrition`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Estimate failed");
      const { nutrition } = await res.json();
      setRecipe({ ...recipe, nutritionPerServing: nutrition });
      toast.success("Macros estimated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Estimate failed");
    } finally {
      setEstimatingNutrition(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${recipe.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/recipes/${recipe.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      router.push("/meals/recipes");
      router.refresh();
    } catch {
      toast.error("Delete failed");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      {recipe.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={recipe.imageUrl} alt="" className="w-full h-64 object-cover rounded-xl mb-4" />
      )}

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">{recipe.title}</h1>
          {recipe.description && <p className="text-sm text-zinc-500 mt-1">{recipe.description}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleFavorite}
            className={fav ? "text-amber-500" : ""}
          >
            <Star className={`h-4 w-4 ${fav ? "fill-amber-500" : ""}`} />
          </Button>
          {canEdit && (
            <>
              <Link href={`/meals/recipes/${recipe.id}/edit`}>
                <Button size="icon" variant="ghost">
                  <Edit className="h-4 w-4" />
                </Button>
              </Link>
              <Button size="icon" variant="ghost" onClick={remove} disabled={busy}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-4">
        <span>{recipe.servings} servings</span>
        {recipe.prepTimeMinutes != null && <span>· {recipe.prepTimeMinutes} min prep</span>}
        {recipe.cookTimeMinutes != null && <span>· {recipe.cookTimeMinutes} min cook</span>}
        {recipe.cookedCount > 0 && <span>· cooked {recipe.cookedCount}×</span>}
        {recipe.visibility === "private" && <span>· private</span>}
        {recipe.sourceUrl && (
          <a href={recipe.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 underline">
            source <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wider text-zinc-500">Our score</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(recipe.score === n ? null : n)}
              className={`p-0.5 rounded ${
                recipe.score != null && n <= recipe.score
                  ? "text-amber-500"
                  : "text-zinc-300 hover:text-zinc-500"
              }`}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
            >
              <Star
                className={`h-5 w-5 ${
                  recipe.score != null && n <= recipe.score ? "fill-amber-500" : ""
                }`}
              />
            </button>
          ))}
          {recipe.score == null && (
            <span className="text-xs text-zinc-400 ml-1">not rated yet</span>
          )}
        </div>
      </div>

      {recipe.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-6">
          {recipe.tags.map((t) => (
            <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={`/meals/recipes/${recipe.id}/cook`}>
          <Button className="gap-2">
            <ChefHat className="h-4 w-4" /> Start cook mode
          </Button>
        </Link>
        <Button variant="secondary" className="gap-2" onClick={() => setPlanDialog(true)}>
          <CalendarPlus className="h-4 w-4" /> Plan for a day
        </Button>
      </div>
      {planDialog && (
        <PlanForDayDialog
          recipeId={recipe.id}
          recipeTitle={recipe.title}
          onClose={() => setPlanDialog(false)}
        />
      )}

      <div className="grid md:grid-cols-[1fr_2fr] gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Ingredients</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {recipe.ingredients.map((ing, idx) => (
                <li key={idx}>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {[ing.quantity, ing.unit].filter(Boolean).join(" ")}
                  </span>{" "}
                  {ing.name}
                  {ing.notes && <span className="text-zinc-500 text-xs"> ({ing.notes})</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Method</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {recipe.instructions.map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="font-semibold text-zinc-400 shrink-0 w-6">{idx + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Nutrition (per serving)</CardTitle>
          {canEdit && recipe.ingredients.length > 0 && (
            <Button
              size="sm"
              variant={recipe.nutritionPerServing ? "ghost" : "secondary"}
              onClick={estimateMacros}
              disabled={estimatingNutrition}
              className="gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {estimatingNutrition
                ? "Estimating…"
                : recipe.nutritionPerServing
                  ? "Re-estimate"
                  : "Estimate from ingredients"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-2 text-xs">
            {[
              { label: "kcal", v: recipe.nutritionPerServing?.calories, unit: "" },
              { label: "protein", v: recipe.nutritionPerServing?.protein, unit: "g" },
              { label: "carbs", v: recipe.nutritionPerServing?.carbs, unit: "g" },
              { label: "fat", v: recipe.nutritionPerServing?.fat, unit: "g" },
              { label: "fiber", v: recipe.nutritionPerServing?.fiber, unit: "g" },
            ].map((x) => (
              <div key={x.label} className="text-center">
                <div className="text-lg font-semibold tabular-nums">
                  {x.v != null ? (
                    <>
                      {x.v}
                      {x.unit}
                    </>
                  ) : (
                    <span className="text-zinc-300 dark:text-zinc-600">—</span>
                  )}
                </div>
                <div className="text-zinc-500">{x.label}</div>
              </div>
            ))}
          </div>
          {!recipe.nutritionPerServing && canEdit && (
            <p className="text-[11px] text-zinc-500 mt-3 text-center">
              Tap <em>Estimate from ingredients</em> above, or{" "}
              <Link href={`/meals/recipes/${recipe.id}/edit`} className="underline">
                fill them in manually
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Pick a date and POST a meal_plan_entry for this recipe. Doesn't replace
// whatever's already on that date — the meals page can still hold multiple
// entries per day. Closes on success and toasts a deep-link to the meals
// week so the user can verify it landed where they expected.
function PlanForDayDialog({
  recipeId,
  recipeTitle,
  onClose,
}: {
  recipeId: string;
  recipeTitle: string;
  onClose: () => void;
}) {
  // Default to today in the viewer's local zone (matches the meals page,
  // which keys entries by YYYY-MM-DD without time).
  const todayLocal = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaultYmd = `${todayLocal.getFullYear()}-${pad(todayLocal.getMonth() + 1)}-${pad(todayLocal.getDate())}`;

  const [date, setDate] = useState(defaultYmd);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!date) return;
    setBusy(true);
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, recipeId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed");
      }
      toast.success(`Planned ${recipeTitle} for ${date}.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <Dialog.Title className="text-lg font-semibold">Plan for a day</Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-500 mt-1">
            Adds <span className="font-medium">{recipeTitle}</span> to the meal plan.
          </Dialog.Description>

          <div className="mt-4 space-y-1.5">
            <label className="text-xs text-zinc-500">Date</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !date}>
              {busy ? "Saving…" : "Plan"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
