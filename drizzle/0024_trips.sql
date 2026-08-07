CREATE TABLE IF NOT EXISTS "trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_household_idx" ON "trips" ("household_id");--> statement-breakpoint
ALTER TABLE "visited_places" ADD COLUMN IF NOT EXISTS "trip_id" uuid REFERENCES "trips"("id") ON DELETE SET NULL;
