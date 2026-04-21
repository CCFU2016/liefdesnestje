"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Ingredient = { quantity: string | null; unit: string | null; name: string; notes: string | null };

export function CookMode({
  recipeId,
  title,
  servings,
  ingredients,
  instructions,
}: {
  recipeId: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  instructions: string[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(-1); // -1 = ingredients checklist screen
  const [finished, setFinished] = useState(false);

  // Wake Lock: keep the screen awake while cooking.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = (await (navigator as Navigator & {
          wakeLock?: { request?: (type: "screen") => Promise<WakeLockSentinel> };
        }).wakeLock?.request?.("screen")) ?? null;
      } catch {
        // older browser / Safari-permission denied — silently continue
      }
    };
    request();
    const onVisibility = () => {
      if (document.visibilityState === "visible") request();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release?.().catch(() => {});
    };
  }, []);

  const markCooked = async () => {
    try {
      const res = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookedIncrement: true }),
      });
      if (!res.ok) throw new Error();
      toast.success("Logged — enjoy!");
    } catch {
      toast.error("Couldn't log it, but enjoy anyway.");
    }
    router.push(`/meals/recipes/${recipeId}`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-zinc-950 flex flex-col overscroll-none">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="min-w-0">
          <div className="text-xs text-zinc-500">Cook mode</div>
          <div className="font-semibold truncate">{title}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/meals/recipes/${recipeId}`)}
          className="gap-1.5 shrink-0"
        >
          <X className="h-4 w-4" /> Exit
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8 md:py-12 flex items-start justify-center">
        <div className="w-full max-w-2xl">
          {step === -1 && (
            <>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Ingredients for {servings}</div>
              <h2 className="text-2xl md:text-3xl font-semibold mb-6">Get these ready</h2>
              <ul className="space-y-3 text-lg md:text-xl">
                {ingredients.map((ing, idx) => (
                  <li key={idx} className="flex items-baseline gap-3">
                    <span className="text-zinc-400 shrink-0 w-8 text-right">{idx + 1}.</span>
                    <span>
                      <span className="font-semibold">
                        {[ing.quantity, ing.unit].filter(Boolean).join(" ")}
                      </span>{" "}
                      {ing.name}
                      {ing.notes && <span className="text-zinc-500 text-base"> ({ing.notes})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step >= 0 && step < instructions.length && (
            <>
              <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
                Step {step + 1} of {instructions.length}
              </div>
              <p className="text-2xl md:text-3xl leading-relaxed">{instructions[step]}</p>
            </>
          )}

          {finished && (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">🍽️</div>
              <h2 className="text-2xl font-semibold mb-6">Done?</h2>
              <div className="flex gap-2 justify-center">
                <Button size="lg" onClick={markCooked}>
                  <Check className="h-5 w-5" /> Yes, mark as cooked
                </Button>
                <Button size="lg" variant="ghost" onClick={() => setFinished(false)}>
                  Not yet
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {!finished && (
        <footer className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 p-4 flex gap-2 justify-between">
          <Button
            variant="ghost"
            size="lg"
            onClick={() => setStep((s) => Math.max(-1, s - 1))}
            disabled={step === -1}
          >
            <ChevronLeft className="h-5 w-5" /> Back
          </Button>
          {step < instructions.length - 1 ? (
            <Button
              size="lg"
              onClick={() => setStep((s) => s + 1)}
              className="flex-1 max-w-xs"
            >
              {step === -1 ? "Start cooking" : "Next"} <ChevronRight className="h-5 w-5" />
            </Button>
          ) : (
            <Button size="lg" onClick={() => setFinished(true)} className="flex-1 max-w-xs">
              Finish <Check className="h-5 w-5" />
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
