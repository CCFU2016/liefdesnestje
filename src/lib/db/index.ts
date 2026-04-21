import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

const globalForDb = globalThis as unknown as {
  dbInstance?: ReturnType<typeof makeDrizzle>;
};

function makeDrizzle() {
  const url = connectionString ?? "";
  if (!url || url.startsWith("pglite://") || url === "pglite") {
    // Local/dev: pglite (Postgres in WASM, in-process, persisted to ./.local-db by default).
    // This branch is used when you haven't set a real Postgres DATABASE_URL yet.
    const { PGlite } = require("@electric-sql/pglite");
    const { drizzle } = require("drizzle-orm/pglite");
    const dataDir = url.startsWith("pglite://") ? url.replace(/^pglite:\/\//, "") : ".local-db";
    const client = new PGlite(dataDir);
    return drizzle(client, { schema });
  }
  // Production / real Postgres
  const postgres = require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 10, idle_timeout: 20, prepare: false });
  return drizzle(client, { schema });
}

export const db = (globalForDb.dbInstance ??= makeDrizzle());
if (process.env.NODE_ENV !== "production") globalForDb.dbInstance = db;

export type DB = typeof db;
