CREATE TABLE IF NOT EXISTS "bucket_list_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bucket_list_categories_household_idx" ON "bucket_list_categories" ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bucket_list_categories_household_name_uniq" ON "bucket_list_categories" ("household_id","name");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bucket_list_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "category_id" uuid REFERENCES "bucket_list_categories"("id") ON DELETE SET NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "title" text NOT NULL,
  "notes" text,
  "links" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "completed_at" timestamp with time zone,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bucket_list_items_household_idx" ON "bucket_list_items" ("household_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bucket_list_items_category_idx" ON "bucket_list_items" ("category_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bucket_list_stars" (
  "item_id" uuid NOT NULL REFERENCES "bucket_list_items"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "stars" integer NOT NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "bucket_list_stars_pk" PRIMARY KEY ("item_id","user_id")
);
