CREATE TABLE IF NOT EXISTS "visited_places" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "country" text,
  "country_code" varchar(2),
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "visited_on" text NOT NULL,
  "with_persons" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visited_places_household_idx" ON "visited_places" ("household_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visited_places_country_idx" ON "visited_places" ("country_code");
