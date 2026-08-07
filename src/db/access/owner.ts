import { and, desc, eq } from "drizzle-orm";

import type { Db } from "../index";
import { wishes } from "../schema";
import { isUuid } from "./ids";
import type { OwnerWish } from "./types";

/**
 * Owner-facing reads.
 *
 * SURPRISE INVARIANT — this module is the owner's only window onto their list,
 * and it must stay blind to who took what. It imports exactly one table and
 * selects an explicit column list, so no join, no column and no DTO field here
 * can carry gift-booking data. A test asserts this file's source text never
 * names that table. Do not add one.
 */

const columns = {
  id: wishes.id,
  ownerId: wishes.ownerId,
  type: wishes.type,
  title: wishes.title,
  url: wishes.url,
  imageKey: wishes.imageKey,
  imageStatus: wishes.imageStatus,
  description: wishes.description,
  priceType: wishes.priceType,
  priceMin: wishes.priceMin,
  priceMax: wishes.priceMax,
  currency: wishes.currency,
  priority: wishes.priority,
  isDream: wishes.isDream,
  category: wishes.category,
  notes: wishes.notes,
  visibility: wishes.visibility,
  status: wishes.status,
  giftedAt: wishes.giftedAt,
  giftedBy: wishes.giftedBy,
  createdAt: wishes.createdAt,
  updatedAt: wishes.updatedAt,
};

/** `active` = the live list, `gifted` = the archive, `all` = both. */
export type OwnerWishStatusFilter = "active" | "gifted" | "all";

export type GetOwnerWishesOptions = {
  /** Defaults to `active`. */
  status?: OwnerWishStatusFilter;
};

export async function getOwnerWishes(
  db: Db,
  ownerId: string,
  options: GetOwnerWishesOptions = {},
): Promise<OwnerWish[]> {
  const status = options.status ?? "active";
  const rows = await db
    .select(columns)
    .from(wishes)
    .where(
      status === "all"
        ? eq(wishes.ownerId, ownerId)
        : and(eq(wishes.ownerId, ownerId), eq(wishes.status, status)),
    )
    .orderBy(desc(wishes.createdAt), desc(wishes.id));
  return rows;
}

export async function getOwnerWish(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<OwnerWish | null> {
  if (!isUuid(wishId)) return null;
  const rows = await db
    .select(columns)
    .from(wishes)
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .limit(1);
  return rows[0] ?? null;
}
