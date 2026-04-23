ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "restaurant_name" text;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "restaurant_url" text;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "restaurant_menu_url" text;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "restaurant_address" text;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD COLUMN IF NOT EXISTS "reservation_at" timestamp with time zone;
