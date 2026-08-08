import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/db";
import { aiUsage } from "@/db/schema";
import { usageDay } from "@/lib/parse/quota";
import type { AiQuotaSnapshot } from "./types";

/**
 * Per-user daily budgets for the Phase 6 assists (CLAUDE.md invariant #4: AI
 * runs only on explicit user action, inside a quota). Two independent pools,
 * counted in `ai_usage` next to `parse`/`upload`:
 *
 *   `text`  — «добавь словами» draft, description and price suggestions;
 *   `image` — generated wish pictures, which cost an order of magnitude more.
 *
 * Like `lib/parse/quota.ts` — and unlike `lib/upload-quota.ts` — these take the
 * `Db` handle instead of reaching for the singleton, so the accounting is
 * testable against PGlite.
 */
export const DAILY_TEXT_LIMIT = 30;
export const DAILY_IMAGE_LIMIT = 10;

export type AiQuotaKind = "text" | "image";

const LIMITS: Record<AiQuotaKind, number> = {
  text: DAILY_TEXT_LIMIT,
  image: DAILY_IMAGE_LIMIT,
};

/**
 * Increments the counter for one pool and reports whether the caller may
 * proceed. Atomic (a single upsert with `returning`), so two tabs firing at
 * once cannot both be told "yes" on the last unit of the budget.
 */
export async function consumeAiQuota(
  db: Db,
  userId: string,
  kind: AiQuotaKind,
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .insert(aiUsage)
    .values({ userId, day: usageDay(now), kind, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day, aiUsage.kind],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });
  return (row?.count ?? 1) <= LIMITS[kind];
}

/**
 * What is left in each pool today, for the "Осталось N" counters. Read-only —
 * the counters are advisory, and the server re-checks with `consumeAiQuota` on
 * every actual call. Clamped at zero: a counter that overran its limit (the
 * refused call still increments) must not render as a negative number.
 */
export async function getAiQuotaRemaining(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<AiQuotaSnapshot> {
  const rows = await db
    .select({ kind: aiUsage.kind, count: aiUsage.count })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, usageDay(now))));

  const used = (kind: AiQuotaKind): number =>
    rows.find((row) => row.kind === kind)?.count ?? 0;

  return {
    text: Math.max(0, DAILY_TEXT_LIMIT - used("text")),
    image: Math.max(0, DAILY_IMAGE_LIMIT - used("image")),
  };
}
