// Shared types and helpers for the meals page components.

export type RecipeOption = {
  id: string;
  title: string;
  imageUrl: string | null;
  servings: number;
};

export type MealEntry = {
  id: string;
  date: string;
  recipeId: string | null;
  freeText: string | null;
  servings: number | null;
  cookedAt: string | null;
  visibility: "private" | "shared";
  authorId: string;
  restaurantName: string | null;
  restaurantUrl: string | null;
  restaurantMenuUrl: string | null;
  restaurantAddress: string | null;
  reservationAt: string | null;
  recipe: {
    id: string;
    title: string;
    imageUrl: string | null;
    servings: number;
    cookTimeMinutes: number | null;
    prepTimeMinutes: number | null;
    ingredients: unknown;
  } | null;
};

export const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type Member = { userId: string; displayName: string; color: string };

export type Absence = { userId: string; date: string };
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function buildMapsUrl(entry: {
  restaurantName: string | null;
  restaurantAddress: string | null;
}): string | null {
  if (!entry.restaurantName && !entry.restaurantAddress) return null;
  const q = [entry.restaurantName, entry.restaurantAddress].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
