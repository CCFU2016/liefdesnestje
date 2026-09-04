ALTER TABLE "calendars" ADD COLUMN IF NOT EXISTS "delta_window_end" timestamp with time zone;
