CREATE TABLE IF NOT EXISTS "ah_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "household_id" uuid NOT NULL UNIQUE REFERENCES "households"("id") ON DELETE CASCADE,
  "connected_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "access_token_enc" text NOT NULL,
  "refresh_token_enc" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "member_id" text,
  "needs_reconnect" boolean NOT NULL DEFAULT false,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
