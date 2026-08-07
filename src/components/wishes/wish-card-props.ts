import type { BaseWish } from "@/components/ui/wish-card";
import type { OwnerWish, ViewerWish } from "@/db/access/types";

/**
 * Bridge between the data-access DTOs and the presentational `WishCard`.
 *
 * The only non-obvious mapping is the image: the `image_key` column stores the
 * finished CDN URL of the copy we re-hosted (see `db/access/mutations.ts`), so
 * it goes straight into `imageUrl`. Everything else is 1:1.
 *
 * Deliberately role-agnostic on the *inputs* only — the caller still has to
 * pick `role="owner"` / `"viewer"` / `"archive"` itself, which is what keeps
 * reservation data off owner screens (see WishCard's prop union).
 */
export function toBaseWish(wish: OwnerWish | ViewerWish): BaseWish {
  return {
    title: wish.title,
    imageUrl: wish.imageKey,
    imageStatus: wish.imageStatus,
    category: wish.category,
    priceType: wish.priceType,
    priceMin: wish.priceMin,
    priceMax: wish.priceMax,
    currency: wish.currency,
    priority: wish.priority,
    isDream: wish.isDream,
  };
}
