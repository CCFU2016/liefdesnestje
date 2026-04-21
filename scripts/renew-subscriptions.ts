import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { renewSubscription as msRenew } from "../src/lib/microsoft/graph";
import { subscribeCalendar as googleSubscribe } from "../src/lib/google/sync";

// Renew provider subscriptions that expire within 24 hours.
// - Microsoft Graph: PATCH the subscription with a new expirationDateTime (max ~70h).
// - Google Calendar: channels can't be extended; stop + create new (subscribeCalendar
//   handles the stop internally).
//
// Run on a cron (Railway Cron service: `0 */6 * * *`).

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);

const due = await db
  .select({
    cal: schema.calendars,
    account: schema.externalCalendarAccounts,
  })
  .from(schema.calendars)
  .innerJoin(
    schema.externalCalendarAccounts,
    eq(schema.calendars.accountId, schema.externalCalendarAccounts.id)
  )
  .where(
    and(
      isNotNull(schema.calendars.subscriptionId),
      lt(schema.calendars.subscriptionExpiresAt, threshold)
    )
  );

console.log(`Renewing ${due.length} subscription(s)`);

for (const { cal, account } of due) {
  if (!cal.subscriptionId) continue;
  try {
    if (account.provider === "microsoft") {
      const renewed = await msRenew(cal.accountId, cal.subscriptionId);
      await db
        .update(schema.calendars)
        .set({
          subscriptionExpiresAt: new Date(renewed.expirationDateTime),
          updatedAt: new Date(),
        })
        .where(eq(schema.calendars.id, cal.id));
    } else if (account.provider === "google") {
      // Google channels aren't renewable — create a fresh one. subscribeCalendar
      // stops the old channel first.
      await googleSubscribe(cal.accountId, cal.id);
    }
    console.log(`✓ ${account.provider}: ${cal.name}`);
  } catch (e) {
    console.error(`✗ renewal failed for ${cal.name}`, e);
  }
}

await client.end();
