"use client";

import Link from "next/link";
import { ChefHat, MapPin, Trash2, Check, UtensilsCrossed } from "lucide-react";
import { format } from "date-fns";
import { type MealEntry, buildMapsUrl } from "../types";

export function MealCardItem({
  entry,
  onEdit,
  onRemove,
  onToggleCooked,
}: {
  entry: MealEntry;
  onEdit: () => void;
  onRemove: () => void;
  onToggleCooked: () => void;
}) {
  const isCooked = !!entry.cookedAt;
  const isRestaurant = !!entry.restaurantName;
  const mapsUrl = buildMapsUrl(entry);
  return (
    <li className="group">
      <div className="flex items-start gap-2">
        {isRestaurant ? (
          <div className="h-10 w-10 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 shrink-0 flex items-center justify-center">
            <UtensilsCrossed className="h-4 w-4" />
          </div>
        ) : entry.recipe?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.recipe.imageUrl}
            alt=""
            className={`h-10 w-10 rounded object-cover shrink-0 ${isCooked ? "opacity-60" : ""}`}
          />
        ) : (
          <div className="h-10 w-10 rounded bg-zinc-100 dark:bg-zinc-800 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <button onClick={onEdit} className="text-sm font-medium text-left truncate block w-full">
            <span className={isCooked ? "line-through text-zinc-400" : ""}>
              {entry.restaurantName ?? entry.recipe?.title ?? entry.freeText ?? "Dinner"}
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {entry.reservationAt && (
              <span className="text-[10px] text-zinc-500">
                {format(new Date(entry.reservationAt), "HH:mm")}
              </span>
            )}
            {entry.recipe?.cookTimeMinutes != null && (
              <span className="text-[10px] text-zinc-500">{entry.recipe.cookTimeMinutes} min</span>
            )}
            {entry.visibility === "private" && (
              <span className="text-[10px] text-zinc-500">· private</span>
            )}
            {entry.restaurantMenuUrl && (
              <a
                href={entry.restaurantMenuUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                onClick={(e) => e.stopPropagation()}
              >
                Menu
              </a>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 hover:underline dark:text-zinc-300"
                onClick={(e) => e.stopPropagation()}
              >
                <MapPin className="h-3 w-3" /> Maps
              </a>
            )}
          </div>
        </div>
        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
          {!isRestaurant && (
            <button
              onClick={onToggleCooked}
              className={`p-1 ${isCooked ? "text-emerald-600" : "text-zinc-400 hover:text-zinc-700"}`}
              title={isCooked ? "Unmark as cooked" : "Mark as cooked"}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          {entry.recipe && !isRestaurant && (
            <Link
              href={`/meals/recipes/${entry.recipe.id}/cook`}
              className="p-1 text-zinc-400 hover:text-zinc-700"
              title="Cook mode"
            >
              <ChefHat className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            onClick={onRemove}
            className="p-1 text-zinc-400 hover:text-red-500"
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

