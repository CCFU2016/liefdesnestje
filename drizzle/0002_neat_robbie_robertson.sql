ALTER TABLE "calendars" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "source_type" varchar(16) DEFAULT 'oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ics_url" text;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "ics_etag" text;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;