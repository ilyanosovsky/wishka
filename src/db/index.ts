import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import * as schema from "./schema";

export * as schema from "./schema";

/**
 * Driver-agnostic handle every data-access function takes. Satisfied by the
 * postgres.js client used in the app and by the PGlite client used in tests.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Wraps an already-created postgres.js client. */
export function createDb(client: postgres.Sql) {
  return drizzle(client, { schema });
}

let cached: Db | undefined;

/**
 * Lazy singleton for the app. DATABASE_URL is read on first call, not at import
 * time, so this module stays importable in environments without a database.
 */
export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    // `prepare: false` keeps us compatible with connection poolers. `max` is
    // per *instance*, and every warm serverless lambda holds its own pool, so
    // the fleet-wide connection count is `max` × instances — one connection per
    // instance, released after 20s idle, is what a free-tier Postgres survives.
    cached = createDb(
      postgres(url, { prepare: false, max: 1, idle_timeout: 20 }),
    );
  }
  return cached;
}
