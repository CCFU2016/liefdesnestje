import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const usePglite = !url || url.startsWith("pglite://") || url === "pglite";
  const migrationsDir = "./drizzle";

  if (usePglite) {
    const { PGlite } = await import("@electric-sql/pglite");
    const dataDir = url.startsWith("pglite://") ? url.replace(/^pglite:\/\//, "") : ".local-db";
    const client = new PGlite(dataDir);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const f of files) {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      const statements = sql
        .split(/-->\s*statement-breakpoint/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        try {
          await client.exec(stmt);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (msg.includes("already exists")) continue;
          throw e;
        }
      }
      console.log(`✓ applied ${f}`);
    }
    await client.close();
  } else {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { max: 1 });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: migrationsDir });
    await client.end();
  }

  console.log("✔ migrations applied");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
