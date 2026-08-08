import { and, eq } from "drizzle-orm";

import type { Locale } from "@/i18n/config";
import type { Db } from "../index";
import { guestIdentities, reservations, user } from "../schema";
import { isUuid } from "./ids";
import { deleteWish } from "./mutations";
import { orphanActiveReservations } from "./reservations";

/**
 * Owner-triggered maintenance that has to touch reservation rows.
 *
 * SURPRISE INVARIANT — `mutations.ts` and `owner.ts` must never learn that this
 * table exists, so the two owner flows that *do* have booking side effects live
 * here instead, wrapped so the owner sees nothing new:
 *
 *  - `deleteWishAsOwner` returns exactly the boolean `deleteWish` returns, and
 *    runs the same statements in the same order whether or not a booking
 *    exists. No branch, no count, no extra round trip to time.
 *  - `getReservationNotificationTarget` is read *only* inside `after()` email
 *    dispatch. Its result must never be returned from a server action, put in a
 *    response payload, logged, or used to decide anything the owner can observe.
 */

/** Thrown to unwind the delete transaction; never escapes this module. */
class WishNotDeleted extends Error {
  constructor() {
    super("wish not deleted");
    this.name = "WishNotDeleted";
  }
}

/**
 * Deletes an owner's wish, marking any booking on it as orphaned first so the
 * holder's "Мои брони" card can say the wish is gone rather than losing it.
 *
 * Both statements are unconditional and share one transaction: if the wish is
 * not the caller's (or does not exist) the orphaning matched nothing anyway,
 * and the rollback leaves the row untouched.
 */
export async function deleteWishAsOwner(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      await orphanActiveReservations(tx, wishId, ownerId);
      if (!(await deleteWish(tx, ownerId, wishId))) {
        throw new WishNotDeleted();
      }
      return true;
    });
  } catch (error) {
    if (error instanceof WishNotDeleted) return false;
    throw error;
  }
}

export type NotificationTarget = {
  reservationId: string;
  email: string | null;
  name: string;
  locale: Locale;
  isGuest: boolean;
  /** The guest's bearer token, for the manage-booking link. Never for a user. */
  guestToken: string | null;
  /** The title as booked, so a deleted wish can still be named in the email. */
  wishTitle: string;
};

/**
 * Who to notify about a change to a wish — the holder of its active booking.
 *
 * SERVER-SIDE ONLY. Read this *before* the change that orphans or gifts the
 * wish, hand it straight to the email senders inside `after()`, and let it die
 * there: it carries a reserver's identity, which is precisely what the owner
 * must never see.
 */
export async function getReservationNotificationTarget(
  db: Db,
  wishId: string,
): Promise<NotificationTarget | null> {
  if (!isUuid(wishId)) return null;

  const [row] = await db
    .select({
      reservationId: reservations.id,
      locale: reservations.locale,
      wishTitle: reservations.wishTitle,
      guestId: reservations.guestId,
      userEmail: user.email,
      userName: user.name,
      guestEmail: guestIdentities.email,
      guestName: guestIdentities.name,
      guestToken: guestIdentities.token,
    })
    .from(reservations)
    .leftJoin(user, eq(user.id, reservations.reserverUserId))
    .leftJoin(guestIdentities, eq(guestIdentities.id, reservations.guestId))
    .where(
      and(eq(reservations.wishId, wishId), eq(reservations.state, "active")),
    )
    .limit(1);
  if (!row) return null;

  const isGuest = row.guestId !== null;
  const name = isGuest ? row.guestName : row.userName;
  // The reserver check constraint guarantees one side of the join resolved;
  // an empty name would still be harmless in an email greeting.
  return {
    reservationId: row.reservationId,
    email: (isGuest ? row.guestEmail : row.userEmail) ?? null,
    name: name ?? "",
    locale: row.locale,
    isGuest,
    guestToken: isGuest ? row.guestToken : null,
    wishTitle: row.wishTitle,
  };
}
