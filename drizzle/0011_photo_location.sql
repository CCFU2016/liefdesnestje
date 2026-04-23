ALTER TABLE "photo_of_the_day" ADD COLUMN IF NOT EXISTS "latitude" text;--> statement-breakpoint
ALTER TABLE "photo_of_the_day" ADD COLUMN IF NOT EXISTS "longitude" text;--> statement-breakpoint
ALTER TABLE "photo_of_the_day" ADD COLUMN IF NOT EXISTS "location_name" text;
