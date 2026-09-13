CREATE TABLE IF NOT EXISTS "ah_product_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "item_key" text NOT NULL,
  "ah_product_id" integer NOT NULL,
  "title" text NOT NULL,
  "image_url" text,
  "last_used_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ah_product_matches_household_key" ON "ah_product_matches" ("household_id", "item_key");--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "ah_sent_at" timestamp with time zone;
