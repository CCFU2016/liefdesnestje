ALTER TABLE "travel_reservations" ADD COLUMN IF NOT EXISTS "start_tz" text;--> statement-breakpoint
ALTER TABLE "travel_reservations" ADD COLUMN IF NOT EXISTS "end_tz" text;
