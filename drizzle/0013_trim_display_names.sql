-- One-shot trim: collapse "Niki van Sprang" → "Niki" so name chips stay
-- compact across the UI. Users can still rename themselves from
-- Settings → You; this migration just strips the default Google-sourced
-- full name that many integrations surface.
UPDATE "household_members"
SET "display_name" = split_part("display_name", ' ', 1)
WHERE position(' ' IN "display_name") > 0;
