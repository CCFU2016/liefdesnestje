-- Force a full re-sync of Microsoft calendars so times previously stored
-- in Laura's local zone (but labelled as UTC) get overwritten with real
-- UTC times now that the Prefer: outlook.timezone="UTC" header is set.
-- Nulling the delta_link makes the next syncCalendarEvents() fall back
-- to the 90d-back / 365d-forward calendarView window and re-upsert every
-- event.
UPDATE "calendars"
SET "delta_link" = NULL, "updated_at" = now()
WHERE "account_id" IN (
  SELECT "id" FROM "external_calendar_accounts" WHERE "provider" = 'microsoft'
);
