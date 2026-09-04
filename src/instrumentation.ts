// Runs once when the Next.js server starts (Node runtime only). We use it
// to refuse to boot with a broken configuration instead of discovering a
// missing secret as a 500 at 2 a.m. See lib/env.ts for what is checked.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("@/lib/env");
  const { missing, invalid, warnings } = validateEnv();

  for (const w of warnings) console.warn(`[env] ${w}`);
  for (const i of invalid) console.error(`[env] ${i}`);

  if (missing.length > 0 || invalid.length > 0) {
    const msg = `[env] refusing to start: missing ${missing.join(", ") || "none"}; invalid ${
      invalid.length ? invalid.length + " value(s)" : "none"
    }`;
    if (process.env.NODE_ENV === "production") throw new Error(msg);
    console.error(msg + " (continuing because NODE_ENV is not production)");
  }
}
