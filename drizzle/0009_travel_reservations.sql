ALTER TABLE "holidays" ADD COLUMN IF NOT EXISTS "has_travel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "travel_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"holiday_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"location" text,
	"confirmation_code" text,
	"reference_url" text,
	"notes" text,
	"origin" text,
	"destination" text,
	"document_url" text,
	"traveler_user_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_reservations" ADD CONSTRAINT "travel_reservations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "travel_reservations" ADD CONSTRAINT "travel_reservations_holiday_id_holidays_id_fk" FOREIGN KEY ("holiday_id") REFERENCES "public"."holidays"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travel_reservations_household_idx" ON "travel_reservations" ("household_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travel_reservations_holiday_idx" ON "travel_reservations" ("holiday_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travel_reservations_range_idx" ON "travel_reservations" ("start_at","end_at");
