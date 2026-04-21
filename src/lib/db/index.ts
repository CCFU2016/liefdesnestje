import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgjsDrizzle } from "drizzle-orm/postgres-js";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

const globalForDb = globalThis as unknown as {
  dbInstance?: ReturnType<typeof makeDrizzle>;
};

function makeDrizzle() {
  const url = connectionString ?? "";
  if (!url || url.startsWith("pglite://") || url === "pglite") {
    // Local/dev: pglite (Postgres in WASM, in-process, persisted to ./.local-db by default).
    const dataDir = url.startsWith("pglite://") ? url.replace(/^pglite:\/\//, "") : ".local-db";
    const client = new PGlite(dataDir);
    return pgliteDrizzle(client, { schema });
  }
  // Production / real Postgres
  const client = postgres(url, { max: 10, idle_timeout: 20, prepare: false });
  return pgjsDrizzle(client, { schema });
}

export const db = (globalForDb.dbInstance ??= makeDrizzle()) as ReturnType<typeof makeDrizzle>;
if (process.env.NODE_ENV !== "production") globalForDb.dbInstance = db;

export type DB = typeof db;
