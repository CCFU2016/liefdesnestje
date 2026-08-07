-- US pins carry their state so the map can fill states, not the whole country.
ALTER TABLE "visited_places" ADD COLUMN IF NOT EXISTS "state" text;
