import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI only. Nothing in the app or the test suite imports this file,
// so DATABASE_URL is required for `db:migrate`/`db:studio` but not for `db:generate`.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/wishka",
  },
  // Column names are spelled out explicitly in schema.ts, so no `casing` mapping
  // is configured here — drizzle-kit and the runtime client stay in sync.
  strict: true,
  verbose: true,
});
