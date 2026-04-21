"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Ingredient = {
  quantity: string | null;
  unit: string | null;
  name: string;
  notes?: string | null;
};

type Nutrition = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

export type RecipeFormValue = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  ingredients: Ingredient[];
  instructions: string[];
  tags: string[];
  nutritionPerServing: Nutrition | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  visibility: "private" | "shared";
};

const EMPTY: RecipeFormValue = {
  title: "",
  description: null,
  servings: 2,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  ingredients: [{ quantity: "", unit: "", name: "", notes: null }],
  instructions: [""],
  tags: [],
  nutritionPerServing: null,
  sourceUrl: null,
  imageUrl: null,
  visibility: "shared",
};

export function RecipeForm({
  initial,
  recipeId, // undefined = create, set = edit
  submitLabel,
}: {
  initial?: Partial<RecipeFormValue>;
  recipeId?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<RecipeFormValue>({ ...EMPTY, ...initial });
  const [tagInput, setTagInput] = useState("");
  const [pending, setPending] = useState(false);

  const save = async () => {
    if (!value.title.trim()) return toast.error("A title is required.");
    setPending(true);
    try {
      const payload = {
        ...value,
        ingredients: value.ingredients.filter((i) => i.name.trim()),
        instructions: value.instructions.filter((s) => s.trim()),
      };
      const res = await fetch(recipeId ? `/api/recipes/${recipeId}` : "/api/recipes", {
        method: recipeId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      const { recipe } = await res.json();
      toast.success(recipeId ? "Saved" : "Recipe added");
      router.push(`/meals/recipes/${recipe.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPending(false);
    }
  };

  const addIngredient = () =>
    setValue((v) => ({
      ...v,
      ingredients: [...v.ingredients, { quantity: "", unit: "", name: "", notes: null }],
    }));

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || value.tags.includes(t)) return;
    setValue((v) => ({ ...v, tags: [...v.tags, t] }));
    setTagInput("");
  };

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{recipeId ? "Edit recipe" : "New recipe"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
              placeholder="e.g. Lentil dal"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Input
              id="desc"
              value={value.description ?? ""}
              onChange={(e) => setValue({ ...value, description: e.target.value || null })}
              placeholder="One-line summary"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Servings</Label>
              <Input
                type="number"
                min={1}
                value={value.servings}
                onChange={(e) => setValue({ ...value, servings: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Prep (min)</Label>
              <Input
                type="number"
                min={0}
                value={value.prepTimeMinutes ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    prepTimeMinutes: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cook (min)</Label>
              <Input
                type="number"
                min={0}
                value={value.cookTimeMinutes ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    cookTimeMinutes: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Image URL (optional)</Label>
            <Input
              value={value.imageUrl ?? ""}
              onChange={(e) => setValue({ ...value, imageUrl: e.target.value || null })}
              placeholder="https://…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Source URL (optional)</Label>
            <Input
              value={value.sourceUrl ?? ""}
              onChange={(e) => setValue({ ...value, sourceUrl: e.target.value || null })}
              placeholder="Where this recipe came from"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Ingredients</CardTitle>
          <Button size="sm" variant="ghost" onClick={addIngredient}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {value.ingredients.map((ing, idx) => (
            <div key={idx} className="grid grid-cols-[70px_70px_1fr_28px] gap-2 items-center">
              <Input
                placeholder="Qty"
                value={ing.quantity ?? ""}
                onChange={(e) => {
                  const next = [...value.ingredients];
                  next[idx] = { ...next[idx], quantity: e.target.value || null };
                  setValue({ ...value, ingredients: next });
                }}
              />
              <Input
                placeholder="Unit"
                value={ing.unit ?? ""}
                onChange={(e) => {
                  const next = [...value.ingredients];
                  next[idx] = { ...next[idx], unit: e.target.value || null };
                  setValue({ ...value, ingredients: next });
                }}
              />
              <Input
                placeholder="Name"
                value={ing.name}
                onChange={(e) => {
                  const next = [...value.ingredients];
                  next[idx] = { ...next[idx], name: e.target.value };
                  setValue({ ...value, ingredients: next });
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setValue({
                    ...value,
                    ingredients: value.ingredients.filter((_, i) => i !== idx),
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Instructions</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setValue({ ...value, instructions: [...value.instructions, ""] })}
          >
            <Plus className="h-3.5 w-3.5" /> Add step
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {value.instructions.map((step, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <span className="shrink-0 text-sm text-zinc-500 pt-2 w-6">{idx + 1}.</span>
              <textarea
                className="flex-1 rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm min-h-[3rem] dark:border-zinc-800"
                value={step}
                onChange={(e) => {
                  const next = [...value.instructions];
                  next[idx] = e.target.value;
                  setValue({ ...value, instructions: next });
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 mt-1"
                onClick={() =>
                  setValue({ ...value, instructions: value.instructions.filter((_, i) => i !== idx) })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Add tag (vegetarian, weeknight, …)"
            />
            <Button size="sm" onClick={addTag}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {value.tags.map((t) => (
              <button
                key={t}
                type="button"
                className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-red-100 dark:hover:bg-red-900"
                onClick={() => setValue({ ...value, tags: value.tags.filter((x) => x !== t) })}
              >
                {t} ×
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm mt-3">
            <input
              type="checkbox"
              checked={value.visibility === "private"}
              onChange={(e) =>
                setValue({ ...value, visibility: e.target.checked ? "private" : "shared" })
              }
            />
            Private (only visible to you)
          </label>
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={() => router.back()} disabled={pending}>Cancel</Button>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : submitLabel ?? (recipeId ? "Save changes" : "Create recipe")}
        </Button>
      </div>
    </div>
  );
}
