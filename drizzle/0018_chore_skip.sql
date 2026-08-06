ALTER TABLE "recurring_chore_completions" ADD COLUMN IF NOT EXISTS "skipped" boolean NOT NULL DEFAULT false;
