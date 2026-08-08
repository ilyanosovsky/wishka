import { eq } from "drizzle-orm";

import type {
  ParseFields,
  ParseStatus,
  PipelineResult,
} from "@/lib/parse/types";
import type { Db } from "../index";
import { parsedUrlCache } from "../schema";

/**
 * `parsed_url_cache` — one parse per URL globally (VISION §5). The row is keyed
 * by the sha-256 of the *normalized* URL and carries no user id: two people
 * pasting the same product link share the result, and neither burns quota for
 * the second hit.
 *
 * Stored images are already re-hosted before a row is written, so a cache hit
 * hands out a URL on our own CDN, never a shop's (invariant #6).
 */

/** Shops change prices and pull products; a week-old parse is worth redoing. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Failures live far shorter than successes. A single transient block (rate
 * limit, brief anti-bot wall, our own timeout) would otherwise poison the
 * *shared* cache for a week — every user who pastes that link gets the manual
 * form even after the shop is reachable again. 30 minutes is enough to spare a
 * retry storm without pinning a bad result.
 */
const FAILED_TTL_MS = 30 * 60 * 1000;

export type CachedParse = {
  fields: ParseFields;
  status: ParseStatus;
  cachedAt: Date;
};

const STATUSES: readonly ParseStatus[] = ["ok", "partial", "failed"];

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The jsonb column is `unknown` at runtime: an older row (or a hand-edited
 *  one) must read as a miss, not crash the action. */
function toCached(data: unknown, createdAt: Date): CachedParse | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { status?: unknown; fields?: unknown };
  const status = record.status;
  if (typeof status !== "string" || !STATUSES.includes(status as ParseStatus)) {
    return null;
  }
  if (!record.fields || typeof record.fields !== "object") return null;
  const raw = record.fields as Record<string, unknown>;

  return {
    status: status as ParseStatus,
    fields: {
      title: stringOrNull(raw.title),
      description: stringOrNull(raw.description),
      imageUrl: stringOrNull(raw.imageUrl),
      priceMin: stringOrNull(raw.priceMin),
      priceMax: stringOrNull(raw.priceMax),
      currency: stringOrNull(raw.currency),
    },
    cachedAt: createdAt,
  };
}

/** Returns null for a miss *and* for a row past its TTL (which is shorter for
 *  cached failures — see `FAILED_TTL_MS`). */
export async function getCachedParse(
  db: Db,
  urlHash: string,
  now: Date = new Date(),
): Promise<CachedParse | null> {
  const [row] = await db
    .select({ data: parsedUrlCache.data, createdAt: parsedUrlCache.createdAt })
    .from(parsedUrlCache)
    .where(eq(parsedUrlCache.urlHash, urlHash))
    .limit(1);
  if (!row) return null;

  const cached = toCached(row.data, row.createdAt);
  if (!cached) return null;

  const ttl = cached.status === "failed" ? FAILED_TTL_MS : TTL_MS;
  if (now.getTime() - row.createdAt.getTime() > ttl) return null;
  return cached;
}

/** Upsert; re-parsing a URL refreshes both the payload and the TTL clock. */
export async function saveParse(
  db: Db,
  urlHash: string,
  url: string,
  result: Pick<PipelineResult, "status" | "fields">,
  now: Date = new Date(),
): Promise<void> {
  const data = { status: result.status, fields: result.fields };
  await db
    .insert(parsedUrlCache)
    .values({ urlHash, url, data, createdAt: now })
    .onConflictDoUpdate({
      target: parsedUrlCache.urlHash,
      set: { url, data, createdAt: now },
    });
}
