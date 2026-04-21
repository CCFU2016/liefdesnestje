-- Event categories (user-managed, per-household) + categoryId on holidays
CREATE TABLE "event_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" varchar(7),
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "event_categories_household_idx" ON "event_categories" ("household_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "event_categories_household_name_uniq" ON "event_categories" ("household_id", "name");
--> statement-breakpoint

ALTER TABLE "holidays" ADD COLUMN "category_id" uuid REFERENCES "event_categories"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "holidays_category_idx" ON "holidays" ("category_id");
