ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "organizer_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "organizer_email" text;--> statement-breakpoint
-- Force a full re-sync on every calendar so existing events pick up their
-- organizer (delta sync only re-delivers events that changed upstream).
UPDATE "calendars" SET "delta_link" = NULL, "sync_token" = NULL, "ics_etag" = NULL;
