import { and, eq } from "drizzle-orm";

import type { Locale } from "@/i18n/config";
import type { Db } from "../index";
import { guestIdentities, reservations, user, wishes } from "../schema";
import { isUuid } from "./ids";
import { deleteWish, markGifted, updateWish } from "./mutations";
import type { WishInput, WishMutationResult } from "./mutations";
import { getOwnerWish } from "./owner";
import { orphanActiveReservations } from "./reservations";
import type { OwnerWish } from "./types";

/**
 * Owner-triggered maintenance that has to touch reservation rows.
 *
 * SURPRISE INVARIANT — `mutations.ts` and `owner.ts` must never learn that this
 * table exists, so the owner flows that *do* have booking side effects live
 * here instead, wrapped so the owner sees nothing new:
 *
 *  - Each wrapper runs the same statements in the same order whether or not a
 *    booking exists, and returns to the owner exactly what the bare mutation
 *    returned. The only extra value is a `notifyReservationId` — an opaque id
 *    captured inside the mutation's own transaction — which the caller must
 *    forward *only* into `after()` and never expose. It is null when no booking
 *    is involved, so its presence cannot be timed or branched on by the owner.
 *  - Capturing the id atomically with the mutation is what makes the email
 *    correct under load. Each wrapper locks the wish row `FOR UPDATE` first —
 *    the same lock `reserveWish` takes — so a reserve cannot interleave with a
 *    delete/edit/gift on the same wish. The single, consistent lock order (wish
 *    row, always first) rules out deadlocks and the "active reservation left
 *    pointing at a deleted wish" / "missed gift notification" races.
 *  - `getReservationNotificationTargetById` resolves that id to a recipient. It
 *    is SERVER-SIDE ONLY: its result carries a reserver's identity and must die
 *    inside the `after()` that reads it — never returned, logged, or rendered.
 *
 * A holder who cancels their booking in the sliver between the mutation
 * committing and `after()` sending still receives the email: they held the wish
 * when it changed, which is exactly what the message is about. That is a
 * deliberate choice, not a race — the *identity* of the recipient is pinned.
 */

/** Thrown to unwind the delete transaction; never escapes this module. */
class WishNotDeleted extends Error {
  constructor() {
    super("wish not deleted");
    this.name = "WishNotDeleted";
  }
}

/**
 * Locks the owner's wish row for the rest of the transaction, establishing the
 * one lock every reservation-touching flow takes first. Must run before the
 * capture below so a concurrent `reserveWish` is serialized, not interleaved.
 */
async function lockWishRow(
  tx: Db,
  ownerId: string,
  wishId: string,
): Promise<void> {
  if (!isUuid(wishId)) return;
  await tx
    .select({ id: wishes.id })
    .from(wishes)
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .for("update")
    .limit(1);
}

/** The active booking on a wish (scoped by the snapshot owner so it can never
 *  match another list's row), captured inside the caller's transaction. */
async function activeReservationId(
  tx: Db,
  wishId: string,
  ownerId: string,
): Promise<string | null> {
  if (!isUuid(wishId)) return null;
  const [row] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.wishId, wishId),
        eq(reservations.state, "active"),
        eq(reservations.listOwnerId, ownerId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export type OwnerMutationOutcome<T> = {
  result: T;
  /** The booking that held the wish at mutation time — feed to `after()` only. */
  notifyReservationId: string | null;
};

/**
 * Deletes an owner's wish, marking any booking on it as orphaned first so the
 * holder's "My bookings" card can say the wish is gone rather than losing it.
 *
 * Every statement is unconditional and shares one transaction: the booking to
 * notify is captured, orphaned, and the wish deleted, in that order, whether or
 * not a booking exists. `deleted` is exactly what `deleteWish` returned.
 */
export async function deleteWishAsOwner(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<OwnerMutationOutcome<boolean>> {
  try {
    return await db.transaction(async (tx) => {
      await lockWishRow(tx, ownerId, wishId);
      const notifyReservationId = await activeReservationId(
        tx,
        wishId,
        ownerId,
      );
      await orphanActiveReservations(tx, wishId, ownerId);
      if (!(await deleteWish(tx, ownerId, wishId))) {
        throw new WishNotDeleted();
      }
      return { result: true, notifyReservationId };
    });
  } catch (error) {
    if (error instanceof WishNotDeleted) {
      return { result: false, notifyReservationId: null };
    }
    throw error;
  }
}

/**
 * Updates a wish and captures, in the same transaction, the booking that held
 * it at that instant. `before` is the pre-update snapshot the caller diffs to
 * decide whether the change is worth emailing about.
 */
export async function updateWishAsOwner(
  db: Db,
  ownerId: string,
  wishId: string,
  input: Partial<WishInput>,
): Promise<
  OwnerMutationOutcome<WishMutationResult> & { before: OwnerWish | null }
> {
  return db.transaction(async (tx) => {
    await lockWishRow(tx, ownerId, wishId);
    const before = await getOwnerWish(tx, ownerId, wishId);
    const result = await updateWish(tx, ownerId, wishId, input);
    const notifyReservationId = result.ok
      ? await activeReservationId(tx, wishId, ownerId)
      : null;
    return { result, before, notifyReservationId };
  });
}

/** Marks a wish gifted, capturing the booking active at that moment in the same
 *  transaction so the "gift delivered" email reaches exactly its holder. */
export async function markGiftedAsOwner(
  db: Db,
  ownerId: string,
  wishId: string,
  giftedBy: string | null,
): Promise<OwnerMutationOutcome<OwnerWish | null>> {
  return db.transaction(async (tx) => {
    await lockWishRow(tx, ownerId, wishId);
    const notifyReservationId = await activeReservationId(tx, wishId, ownerId);
    const wish = await markGifted(tx, ownerId, wishId, giftedBy);
    return {
      result: wish,
      notifyReservationId: wish ? notifyReservationId : null,
    };
  });
}

export type NotificationTarget = {
  reservationId: string;
  email: string | null;
  name: string;
  locale: Locale;
  isGuest: boolean;
  /** The reserving guest's id, so a caller can prove the booking is theirs
   *  before sending a guest-facing email. Null for a signed-in reserver. */
  guestId: string | null;
  /** The guest's bearer token, for the manage-booking link. Never for a user. */
  guestToken: string | null;
  /** The title as booked, so a deleted wish can still be named in the email. */
  wishTitle: string;
};

const targetColumns = {
  reservationId: reservations.id,
  locale: reservations.locale,
  wishTitle: reservations.wishTitle,
  guestId: reservations.guestId,
  userEmail: user.email,
  userName: user.name,
  guestEmail: guestIdentities.email,
  guestName: guestIdentities.name,
  guestToken: guestIdentities.token,
};

type TargetRow = {
  reservationId: string;
  locale: Locale;
  wishTitle: string;
  guestId: string | null;
  userEmail: string | null;
  userName: string | null;
  guestEmail: string | null;
  guestName: string | null;
  guestToken: string | null;
};

function toTarget(row: TargetRow): NotificationTarget {
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
    guestId: row.guestId,
    guestToken: isGuest ? row.guestToken : null,
    wishTitle: row.wishTitle,
  };
}

/**
 * Resolves a reservation id (captured atomically with an owner mutation) to its
 * recipient, in any state — an `orphaned` row from a delete still names its
 * holder. SERVER-SIDE ONLY; consume the result inside `after()` and let it die.
 */
export async function getReservationNotificationTargetById(
  db: Db,
  reservationId: string,
): Promise<NotificationTarget | null> {
  if (!isUuid(reservationId)) return null;

  const [row] = await db
    .select(targetColumns)
    .from(reservations)
    .leftJoin(user, eq(user.id, reservations.reserverUserId))
    .leftJoin(guestIdentities, eq(guestIdentities.id, reservations.guestId))
    .where(eq(reservations.id, reservationId))
    .limit(1);
  return row ? toTarget(row) : null;
}

/**
 * Who to notify about a change to a wish — the holder of its *active* booking.
 * Used by the guest-confirmation flow, where the caller just created the
 * booking and scopes the send by guest id. Owner mutations use the id-based
 * variant above so the recipient is pinned atomically.
 */
export async function getReservationNotificationTarget(
  db: Db,
  wishId: string,
): Promise<NotificationTarget | null> {
  if (!isUuid(wishId)) return null;

  const [row] = await db
    .select(targetColumns)
    .from(reservations)
    .leftJoin(user, eq(user.id, reservations.reserverUserId))
    .leftJoin(guestIdentities, eq(guestIdentities.id, reservations.guestId))
    .where(
      and(eq(reservations.wishId, wishId), eq(reservations.state, "active")),
    )
    .limit(1);
  return row ? toTarget(row) : null;
}
