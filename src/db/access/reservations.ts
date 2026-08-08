import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { Locale } from "@/i18n/config";
import type { Db } from "../index";
import { reservations, wishes } from "../schema";
import { isUniqueViolation } from "./errors";
import { isUuid } from "./ids";
import type { Reserver, Viewer } from "./types";
import { visibleTo } from "./viewer";

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "already_reserved" | "not_found" };

export type CancelResult = { ok: true } | { ok: false; reason: "not_found" };

/**
 * A guest id that is not a uuid can only come from a stale/forged token, and
 * would make Postgres raise `22P02` rather than simply match nothing. Exported
 * so every module that scopes a query by reserver can refuse it first.
 */
export function hasUsableIdentity(reserver: Reserver): boolean {
  return "userId" in reserver
    ? reserver.userId.length > 0
    : isUuid(reserver.guestId);
}

function asViewer(reserver: Reserver): Viewer {
  return "userId" in reserver
    ? { userId: reserver.userId }
    : { guestId: reserver.guestId };
}

/**
 * The rows this reserver holds. Exported because `my-reservations.ts` must
 * scope its query by exactly the same rule — one identity test, one place.
 */
export function reserverMatch(reserver: Reserver): SQL | undefined {
  return "userId" in reserver
    ? and(
        eq(reservations.reserverUserId, reserver.userId),
        isNull(reservations.guestId),
      )
    : and(
        eq(reservations.guestId, reserver.guestId),
        isNull(reservations.reserverUserId),
      );
}

function isOwnList(ownerId: string, reserver: Reserver): boolean {
  return "userId" in reserver && reserver.userId === ownerId;
}

export type ReserveOptions = {
  /** The reserver's UI language, stored for later notification emails. */
  locale?: Locale;
};

/**
 * Takes the single active-reservation slot for a wish.
 *
 * Two guards keep this from becoming an oracle the owner could query:
 * a wish the reserver is not allowed to see, and a wish the reserver owns,
 * both come back as plain `not_found` — never a distinct reason, never
 * `already_reserved`, which would itself reveal that someone booked a gift.
 *
 * Concurrency is settled by the DB, not by a read-then-write check: the loser
 * of the race gets the unique violation and is told the wish is already taken.
 *
 * The row also copies the wish as it looked right now. That snapshot is what
 * survives the owner deleting or rewriting the wish, and diffing it against the
 * live row is how "Мои брони" reports what changed.
 */
export async function reserveWish(
  db: Db,
  wishId: string,
  reserver: Reserver,
  options: ReserveOptions = {},
): Promise<ReserveResult> {
  if (!isUuid(wishId) || !hasUsableIdentity(reserver)) {
    return { ok: false, reason: "not_found" };
  }

  const wish = await db
    .select({
      id: wishes.id,
      ownerId: wishes.ownerId,
      title: wishes.title,
      url: wishes.url,
      priceType: wishes.priceType,
      priceMin: wishes.priceMin,
      priceMax: wishes.priceMax,
      currency: wishes.currency,
    })
    .from(wishes)
    .where(
      and(
        eq(wishes.id, wishId),
        eq(wishes.status, "active"),
        visibleTo(asViewer(reserver)),
      ),
    )
    .limit(1);
  if (wish.length === 0 || isOwnList(wish[0].ownerId, reserver)) {
    return { ok: false, reason: "not_found" };
  }
  const snapshot = wish[0];

  try {
    const [row] = await db
      .insert(reservations)
      .values({
        wishId,
        listOwnerId: snapshot.ownerId,
        wishTitle: snapshot.title,
        wishUrl: snapshot.url,
        wishPriceType: snapshot.priceType,
        wishPriceMin: snapshot.priceMin,
        wishPriceMax: snapshot.priceMax,
        wishCurrency: snapshot.currency,
        locale: options.locale ?? "ru",
        reserverUserId: "userId" in reserver ? reserver.userId : null,
        guestId: "guestId" in reserver ? reserver.guestId : null,
        state: "active",
      })
      .returning({ id: reservations.id });
    return { ok: true, reservationId: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "already_reserved" };
    }
    throw error;
  }
}

/**
 * Cancels only the caller's own active reservation; frees the slot.
 *
 * Visibility is deliberately *not* re-checked: when an owner narrows a wish's
 * audience the existing reservation survives, and its holder must still be able
 * to release it. The owner of the wish, however, is turned away like anyone
 * without a booking.
 */
export async function cancelReservation(
  db: Db,
  wishId: string,
  reserver: Reserver,
): Promise<CancelResult> {
  if (!isUuid(wishId) || !hasUsableIdentity(reserver)) {
    return { ok: false, reason: "not_found" };
  }

  const wish = await db
    .select({ ownerId: wishes.ownerId })
    .from(wishes)
    .where(eq(wishes.id, wishId))
    .limit(1);
  if (wish.length === 0 || isOwnList(wish[0].ownerId, reserver)) {
    return { ok: false, reason: "not_found" };
  }

  const cancelled = await db
    .update(reservations)
    .set({ state: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(reservations.wishId, wishId),
        eq(reservations.state, "active"),
        reserverMatch(reserver),
      ),
    )
    .returning({ id: reservations.id });

  return cancelled.length > 0
    ? { ok: true }
    : { ok: false, reason: "not_found" };
}

/**
 * Releases a booking from "Мои брони", where the reservation id is the only
 * handle the holder has: the wish may already be gone, in which case `wish_id`
 * is NULL and `cancelReservation`'s wish-first lookup has nothing to work with.
 *
 * `orphaned` is accepted alongside `active` — dismissing a dead card is the
 * same gesture as releasing a live booking. Anything the caller does not hold
 * (or already cancelled) is `not_found`, so ids stay unenumerable.
 */
export async function dismissReservation(
  db: Db,
  reservationId: string,
  reserver: Reserver,
): Promise<CancelResult> {
  if (!isUuid(reservationId) || !hasUsableIdentity(reserver)) {
    return { ok: false, reason: "not_found" };
  }

  const cancelled = await db
    .update(reservations)
    .set({ state: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(reservations.id, reservationId),
        inArray(reservations.state, ["active", "orphaned"]),
        reserverMatch(reserver),
      ),
    )
    .returning({ id: reservations.id });

  return cancelled.length > 0
    ? { ok: true }
    : { ok: false, reason: "not_found" };
}

/**
 * Marks the bookings of a wish that is about to disappear, so their holders
 * learn the wish is gone instead of watching it vanish silently.
 *
 * SURPRISE INVARIANT — this runs on an owner-triggered path, so it must stay
 * write-only: no count, no boolean, nothing an owner-visible value could be
 * derived from. It is also unconditional at the call site, which is what keeps
 * a delete indistinguishable between a booked and an unbooked wish.
 *
 * The ownership test lives inside the statement (not in a prior SELECT) for the
 * same reason: one round trip, same shape either way.
 */
export async function orphanActiveReservations(
  db: Db,
  wishId: string,
  ownerId: string,
): Promise<void> {
  if (!isUuid(wishId)) return;

  await db
    .update(reservations)
    .set({ state: "orphaned", orphanedAt: new Date() })
    .where(
      and(
        eq(reservations.wishId, wishId),
        eq(reservations.state, "active"),
        sql`exists (select 1 from "wishes" w where w."id" = ${wishId} and w."owner_id" = ${ownerId})`,
      ),
    );
}
