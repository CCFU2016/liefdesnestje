CREATE TABLE IF NOT EXISTS "recurring_chores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"days_of_week" integer[] NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"points_value" integer DEFAULT 1 NOT NULL,
	"rolls_over" boolean DEFAULT false NOT NULL,
	"rolls_over_since" text,
	"visibility" "visibility" DEFAULT 'shared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_chores_days_nonempty" CHECK (cardinality("days_of_week") > 0),
	CONSTRAINT "recurring_chores_points_range" CHECK ("points_value" BETWEEN 1 AND 10)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_chores" ADD CONSTRAINT "recurring_chores_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_chores" ADD CONSTRAINT "recurring_chores_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_chores_household_idx" ON "recurring_chores" ("household_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_chore_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chore_id" uuid NOT NULL,
	"completed_by_id" uuid NOT NULL,
	"completed_on" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"points_awarded" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_chore_completions" ADD CONSTRAINT "recurring_chore_completions_chore_id_recurring_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."recurring_chores"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_chore_completions" ADD CONSTRAINT "recurring_chore_completions_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recurring_chore_completions_chore_date_unique" ON "recurring_chore_completions" ("chore_id","completed_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_chore_completions_chore_idx" ON "recurring_chore_completions" ("chore_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_chore_completions_user_date_idx" ON "recurring_chore_completions" ("completed_by_id","completed_on");
