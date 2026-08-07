import { and, eq, isNull } from "drizzle-orm";

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

/** A guest id that is not a uuid can only come from a stale/forged token. */
function hasUsableIdentity(reserver: Reserver): boolean {
  return "userId" in reserver
    ? reserver.userId.length > 0
    : isUuid(reserver.guestId);
}

function asViewer(reserver: Reserver): Viewer {
  return "userId" in reserver
    ? { userId: reserver.userId }
    : { guestId: reserver.guestId };
}

function reserverMatch(reserver: Reserver) {
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
 */
export async function reserveWish(
  db: Db,
  wishId: string,
  reserver: Reserver,
): Promise<ReserveResult> {
  if (!isUuid(wishId) || !hasUsableIdentity(reserver)) {
    return { ok: false, reason: "not_found" };
  }

  const wish = await db
    .select({ id: wishes.id, ownerId: wishes.ownerId })
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

  try {
    const [row] = await db
      .insert(reservations)
      .values({
        wishId,
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
