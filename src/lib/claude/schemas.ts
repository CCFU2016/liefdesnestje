import { z } from "zod";

// What Claude extracts from images / URLs / text / captions.
// Matches the DB recipe shape minus server-owned fields (id, counts, visibility, etc.)
export const ExtractedIngredientSchema = z.object({
  quantity: z.string().nullable(), // free-form: "1", "1/2", "a pinch"
  unit: z.string().nullable(), // "g", "tbsp", "cup", or null for count items
  name: z.string(),
  notes: z.string().nullable(), // "finely chopped", "room temp"
});

export const ExtractedNutritionSchema = z.object({
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  carbs: z.number().nullable(),
  fat: z.number().nullable(),
  fiber: z.number().nullable(),
});

export const ExtractedRecipeSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().int().positive(),
  prepTimeMinutes: z.number().int().nonnegative().nullable(),
  cookTimeMinutes: z.number().int().nonnegative().nullable(),
  ingredients: z.array(ExtractedIngredientSchema),
  instructions: z.array(z.string()),
  tags: z.array(z.string()),
  nutritionPerServing: ExtractedNutritionSchema.nullable(),
});

export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>;

// Social captions — Claude tells us whether the caption actually contained a recipe.
export const SocialExtractionSchema = z.object({
  found: z.boolean(),
  recipe: ExtractedRecipeSchema.nullable(),
  reason: z.string().nullable(), // e.g. "caption is just 'yum!'", used when found=false
});

export type SocialExtraction = z.infer<typeof SocialExtractionSchema>;

// Aggregated shopping-list items.
export const AggregatedIngredientSchema = z.object({
  name: z.string(),
  totalAmount: z.string(), // already-formatted, e.g. "3", "200g", "1 tbsp + 100g"
  unit: z.string().nullable(),
  sourceRecipes: z.array(z.string()), // recipe titles that contributed
});

export const AggregatedListSchema = z.object({
  items: z.array(AggregatedIngredientSchema),
});

export type AggregatedIngredient = z.infer<typeof AggregatedIngredientSchema>;
export type AggregatedList = z.infer<typeof AggregatedListSchema>;

// Estimated nutrition — same shape as ExtractedNutrition but non-nullable
// numbers (we want a best-guess for every field).
export const EstimatedNutritionSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  fiber: z.number(),
});

export type EstimatedNutrition = z.infer<typeof EstimatedNutritionSchema>;

// Restaurant pages — the user pastes a URL, we fetch the landing HTML, and
// Claude pulls out the fields we want to surface on the dinner card.
export const ExtractedRestaurantSchema = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  // Direct link to the menu page or PDF. Resolved to an absolute URL.
  menuUrl: z.string().nullable(),
});

export type ExtractedRestaurant = z.infer<typeof ExtractedRestaurantSchema>;

// Travel reservation documents (hotel bookings, flight e-tickets, train
// confirmations). The user uploads a PDF or a screenshot and Claude fills
// in the structured form — user then confirms before save.
export const ExtractedReservationSchema = z.object({
  kind: z.enum(["hotel", "flight", "train", "car_rental", "ferry", "transit", "other"]),
  title: z.string(), // short display name, e.g. "Marriott Amsterdam" or "KL1234 AMS→JFK"
  // ISO 8601 strings. startAt is required; for hotels use check-in date-time.
  startAt: z.string(),
  endAt: z.string().nullable(),
  location: z.string().nullable(),
  confirmationCode: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  notes: z.string().nullable(),
});

export type ExtractedReservation = z.infer<typeof ExtractedReservationSchema>;
