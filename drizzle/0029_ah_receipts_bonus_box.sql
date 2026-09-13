ALTER TABLE "ah_connections" ADD COLUMN IF NOT EXISTS "receipts_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ah_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "bought_at" timestamp with time zone NOT NULL,
  "total" double precision,
  "imported_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ah_receipts_household_idx" ON "ah_receipts" ("household_id", "bought_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ah_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" text NOT NULL REFERENCES "ah_receipts"("id") ON DELETE CASCADE,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "pos_product_id" integer,
  "webshop_id" integer,
  "name" text NOT NULL,
  "quantity" double precision,
  "amount" double precision,
  "in_bonus" boolean NOT NULL DEFAULT false,
  "bonus_kind" text
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ah_receipt_lines_household_product_idx" ON "ah_receipt_lines" ("household_id", "webshop_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ah_pos_products" (
  "pos_product_id" integer PRIMARY KEY NOT NULL,
  "webshop_id" integer,
  "checked_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ah_bonus_activations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL REFERENCES "households"("id") ON DELETE CASCADE,
  "segment_id" text NOT NULL,
  "title" text NOT NULL,
  "discount" text,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "score" integer NOT NULL,
  "status" text NOT NULL,
  "message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ah_bonus_activations_unique" ON "ah_bonus_activations" ("household_id", "segment_id", "period_start");
