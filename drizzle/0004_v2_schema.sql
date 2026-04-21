-- Drop v1 trips (no user data) + v1-only trip_item_type enum
DROP TABLE IF EXISTS "trip_items" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "trips" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "trip_item_type";
--> statement-breakpoint

-- v2: add source column to todos for shopping-list tagging
ALTER TABLE "todos" ADD COLUMN "source" text;
--> statement-breakpoint

-- v2: holidays
CREATE TABLE "holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "title" text NOT NULL,
  "description" text,
  "starts_on" text NOT NULL,
  "ends_on" text,
  "for_persons" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "document_url" text,
  "push_to_calendar" boolean NOT NULL DEFAULT false,
  "external_calendar_event_id" text,
  "external_calendar_provider" "calendar_provider",
  "external_calendar_id" uuid REFERENCES "calendars"("id") ON DELETE SET NULL,
  "visibility" "visibility" NOT NULL DEFAULT 'shared',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "holidays_household_idx" ON "holidays" ("household_id");
--> statement-breakpoint
CREATE INDEX "holidays_starts_idx" ON "holidays" ("starts_on");
--> statement-breakpoint

-- v2: recipes
CREATE TABLE "recipes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "title" text NOT NULL,
  "description" text,
  "servings" integer NOT NULL DEFAULT 2,
  "prep_time_minutes" integer,
  "cook_time_minutes" integer,
  "ingredients" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "instructions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tags" text[] NOT NULL DEFAULT '{}'::text[],
  "nutrition_per_serving" jsonb,
  "source_url" text,
  "image_url" text,
  "cooked_count" integer NOT NULL DEFAULT 0,
  "visibility" "visibility" NOT NULL DEFAULT 'shared',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "recipes_household_idx" ON "recipes" ("household_id");
--> statement-breakpoint
CREATE INDEX "recipes_title_idx" ON "recipes" ("title");
--> statement-breakpoint

-- v2: recipe_favorites (composite PK: per-user per-recipe)
CREATE TABLE "recipe_favorites" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "recipe_id")
);
--> statement-breakpoint

-- v2: meal_plan_entries
CREATE TABLE "meal_plan_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "date" text NOT NULL,
  "recipe_id" uuid REFERENCES "recipes"("id") ON DELETE SET NULL,
  "free_text" text,
  "servings" integer,
  "cooked_at" timestamp with time zone,
  "visibility" "visibility" NOT NULL DEFAULT 'shared',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "meal_plan_household_idx" ON "meal_plan_entries" ("household_id");
--> statement-breakpoint
CREATE INDEX "meal_plan_date_idx" ON "meal_plan_entries" ("date");
--> statement-breakpoint

-- v2: claude_usage (per-call log)
CREATE TABLE "claude_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "call_type" text NOT NULL,
  "success" boolean NOT NULL,
  "input_size_bytes" integer,
  "output_size_bytes" integer,
  "latency_ms" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "claude_usage_user_day_idx" ON "claude_usage" ("user_id", "date");
