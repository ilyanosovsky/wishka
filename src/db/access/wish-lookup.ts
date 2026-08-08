import { and, eq } from "drizzle-orm";

import type { Db } from "../index";
import { wishes } from "../schema";

/**
 * "You already have this" — the duplicate hint on the add-by-URL screen.
 *
 * SURPRISE INVARIANT — like `owner.ts`, this module reads exactly one table and
 * returns two columns. It answers a question about the *owner's own* list, so
 * it must never learn anything about bookings. Do not join here.
 *
 * The match is on the stored URL exactly as saved; both sides come out of
 * `normalizeUrl`, so campaign links and fragments do not create false misses.
 */
export async function findActiveWishByUrl(
  db: Db,
  ownerId: string,
  url: string,
): Promise<{ id: string; title: string } | null> {
  if (!url) return null;
  const [row] = await db
    .select({ id: wishes.id, title: wishes.title })
    .from(wishes)
    .where(
      and(
        eq(wishes.ownerId, ownerId),
        eq(wishes.status, "active"),
        eq(wishes.url, url),
      ),
    )
    .limit(1);
  return row ?? null;
}
