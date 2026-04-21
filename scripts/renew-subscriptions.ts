import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { renewSubscription } from "../src/lib/microsoft/graph";

// Renew Microsoft Graph subscriptions that expire within 24 hours. Run on a
// cron (Railway: add a cron service running `pnpm cron:renew-subscriptions`
// every 6 hours).

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);

const due = await db
  .select()
  .from(schema.calendars)
  .where(and(isNotNull(schema.calendars.subscriptionId), lt(schema.calendars.subscriptionExpiresAt, threshold)));

console.log(`Renewing ${due.length} subscription(s)`);

for (const cal of due) {
  if (!cal.subscriptionId) continue;
  try {
    const renewed = await renewSubscription(cal.accountId, cal.subscriptionId);
    await db
      .update(schema.calendars)
      .set({
        subscriptionExpiresAt: new Date(renewed.expirationDateTime),
        updatedAt: new Date(),
      })
      .where(eq(schema.calendars.id, cal.id));
    console.log("✓", cal.name);
  } catch (e) {
    console.error("✗ renewal failed for", cal.name, e);
  }
}

await client.end();
