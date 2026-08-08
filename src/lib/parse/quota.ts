import { sql } from "drizzle-orm";

import type { Db } from "@/db";
import { aiUsage } from "@/db/schema";

/**
 * Per-user daily budget for link parsing (CLAUDE.md invariant #4: AI runs only
 * on explicit user action, inside a quota). Counted in `ai_usage` under kind
 * `parse`, next to `image`/`text`/`upload`.
 *
 * Unlike `lib/upload-quota.ts` this takes the `Db` handle instead of reaching
 * for the singleton, so the accounting is testable against PGlite.
 */
export const DAILY_PARSE_LIMIT = 50;

/** UTC calendar day, matching the `date` column. */
export function usageDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Increments the counter and reports whether the caller may proceed. Cache
 * hits must not call this: a link someone else already parsed costs us nothing.
 */
export async function consumeParseQuota(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .insert(aiUsage)
    .values({ userId, day: usageDay(now), kind: "parse", count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day, aiUsage.kind],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });
  return (row?.count ?? 1) <= DAILY_PARSE_LIMIT;
}
