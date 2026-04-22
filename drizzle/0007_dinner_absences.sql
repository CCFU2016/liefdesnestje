CREATE TABLE IF NOT EXISTS "dinner_absences" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dinner_absences_household_id_user_id_date_pk" PRIMARY KEY("household_id","user_id","date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dinner_absences" ADD CONSTRAINT "dinner_absences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dinner_absences" ADD CONSTRAINT "dinner_absences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dinner_absences_household_date_idx" ON "dinner_absences" ("household_id","date");
