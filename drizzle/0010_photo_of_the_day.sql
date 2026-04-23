CREATE TABLE IF NOT EXISTS "household_photo_albums" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"share_url" text NOT NULL,
	"album_token" text NOT NULL,
	"base_url" text,
	"stream_name" text,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "household_photo_albums" ADD CONSTRAINT "household_photo_albums_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo_of_the_day" (
	"household_id" uuid NOT NULL,
	"date" text NOT NULL,
	"photo_guid" text NOT NULL,
	"local_path" text NOT NULL,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"caption" text,
	"contributor_name" text,
	"taken_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_of_the_day_household_id_date_pk" PRIMARY KEY("household_id","date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo_of_the_day" ADD CONSTRAINT "photo_of_the_day_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_of_the_day_household_idx" ON "photo_of_the_day" ("household_id");
