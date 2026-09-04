export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

// Variables the app cannot run without in production. Anything listed here
// that is missing makes the server refuse to boot (see src/instrumentation.ts)
// — a loud failure at deploy time rather than a quiet one weeks later.
const REQUIRED = ["DATABASE_URL", "AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "ENCRYPTION_KEY", "WEBHOOK_SECRET"] as const;

// Optional features: we only warn, naming what stops working without them.
const OPTIONAL: Record<string, string> = {
  ANTHROPIC_API_KEY: "recipe, restaurant and ticket extraction is disabled",
  MS_CLIENT_ID: "Microsoft calendar sync cannot be connected",
  MS_CLIENT_SECRET: "Microsoft calendar sync cannot be connected",
  MS_TENANT_ID: "Microsoft calendar sync cannot be connected",
  ALLOWED_EMAILS: "no new accounts can sign in (existing ones still can)",
  CRON_SECRET: "the daily-photo prewarm and backup endpoints are disabled",
  NEXT_PUBLIC_APP_URL: "OAuth redirect URLs fall back to the request host",
};

export type EnvReport = { missing: string[]; invalid: string[]; warnings: string[] };

export function validateEnv(env: Record<string, string | undefined> = process.env): EnvReport {
  const missing: string[] = [];
  const invalid: string[] = [];
  const warnings: string[] = [];

  for (const name of REQUIRED) {
    if (!env[name]) missing.push(name);
  }
  for (const [name, consequence] of Object.entries(OPTIONAL)) {
    if (!env[name]) warnings.push(`${name} is not set: ${consequence}`);
  }

  const key = env.ENCRYPTION_KEY;
  if (key && !/^[0-9a-fA-F]{64}$/.test(key)) {
    invalid.push("ENCRYPTION_KEY must be 64 hex characters (32 bytes); generate one with: openssl rand -hex 32");
  }
  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) {
    invalid.push("AUTH_SECRET is too short; generate one with: openssl rand -base64 32");
  }
  if (env.WEBHOOK_SECRET && env.WEBHOOK_SECRET.length < 16) {
    invalid.push("WEBHOOK_SECRET is too short (min 16 chars)");
  }
  if (env.CRON_SECRET && env.CRON_SECRET.length < 16) {
    invalid.push("CRON_SECRET is too short (min 16 chars); generate one with: openssl rand -hex 24");
  }

  return { missing, invalid, warnings };
}
