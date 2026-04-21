import { db } from "@/lib/db";
import { eventCategories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Ensure a household has the default category set. Idempotent — does
 * nothing if categories already exist. Call on the first read path so
 * existing households get seeded lazily without a migration.
 */
export async function ensureDefaultCategories(householdId: string): Promise<void> {
  const existing = await db
    .select({ id: eventCategories.id })
    .from(eventCategories)
    .where(eq(eventCategories.householdId, householdId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(eventCategories).values([
    { householdId, name: "holidays", color: "#0891b2", sortOrder: 0 },
    { householdId, name: "events", color: "#7c3aed", sortOrder: 1 },
  ]);
}
