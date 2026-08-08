"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db";
import {
  createWish,
  restoreWish,
  type WishInput,
  type WishValidationError,
} from "@/db/access/mutations";
import type { OwnerWish } from "@/db/access/types";
import {
  deleteWishAsOwner,
  getReservationNotificationTargetById,
  markGiftedAsOwner,
  updateWishAsOwner,
} from "@/db/access/wish-lifecycle";
import { getAuth } from "@/lib/auth";
import type { ReservationChangedField } from "@/lib/email/copy";
import {
  sendGiftGiven,
  sendReservedWishChanged,
  sendReservedWishDeleted,
} from "@/lib/email/reservation-emails";

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user.id;
}

/**
 * SURPRISE INVARIANT — every owner mutation captures the booking to notify
 * *atomically inside its own transaction* (`updateWishAsOwner` &co.), then
 * dispatches the email from that opaque id inside `after()` (post-response).
 * The captured id never reaches a return value, and the owner-visible result of
 * each action is exactly what it was before reservations existed.
 */

function wishAppUrl(wishId: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/w/${wishId}`;
}

/** The fields a reserver is told about (§6.7): title, link, price. */
function materialChanges(
  before: OwnerWish,
  updated: OwnerWish,
): ReservationChangedField[] {
  const changed: ReservationChangedField[] = [];
  if (before.title !== updated.title) changed.push("title");
  if ((before.url ?? null) !== (updated.url ?? null)) changed.push("url");
  if (
    before.priceType !== updated.priceType ||
    before.priceMin !== updated.priceMin ||
    before.priceMax !== updated.priceMax ||
    before.currency !== updated.currency
  ) {
    changed.push("price");
  }
  return changed;
}

export type WishActionResult =
  | { ok: true; wish: OwnerWish }
  | { ok: false; error: WishValidationError | "not_found" };

export async function createWishAction(
  input: WishInput,
): Promise<WishActionResult> {
  const userId = await requireUserId();
  const result = await createWish(getDb(), userId, input);
  if (result.ok) revalidatePath("/");
  return result;
}

export async function updateWishAction(
  wishId: string,
  input: Partial<WishInput>,
): Promise<WishActionResult> {
  const userId = await requireUserId();
  const { result, before, notifyReservationId } = await updateWishAsOwner(
    getDb(),
    userId,
    wishId,
    input,
  );
  if (result.ok) {
    const changed = before ? materialChanges(before, result.wish) : [];
    if (changed.length > 0 && notifyReservationId) {
      after(async () => {
        const target = await getReservationNotificationTargetById(
          getDb(),
          notifyReservationId,
        );
        if (target?.email) {
          await sendReservedWishChanged({
            to: target.email,
            locale: target.locale,
            wishTitle: target.wishTitle,
            changedFields: changed,
            wishAppUrl: wishAppUrl(wishId),
          });
        }
      });
    }
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return result;
}

/** Called after the 5s undo window expires — the UI removal is optimistic. */
export async function deleteWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const { result: ok, notifyReservationId } = await deleteWishAsOwner(
    getDb(),
    userId,
    wishId,
  );
  if (ok) {
    if (notifyReservationId) {
      after(async () => {
        const target = await getReservationNotificationTargetById(
          getDb(),
          notifyReservationId,
        );
        if (target?.email) {
          await sendReservedWishDeleted({
            to: target.email,
            locale: target.locale,
            wishTitle: target.wishTitle,
          });
        }
      });
    }
    revalidatePath("/");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok };
}

export async function markGiftedAction(
  wishId: string,
  giftedBy: string | null,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  // giftedBy is FREE TEXT by invariant #1 — never derived from reservations.
  const { result: wish, notifyReservationId } = await markGiftedAsOwner(
    getDb(),
    userId,
    wishId,
    giftedBy?.trim() || null,
  );
  if (wish) {
    // "Your gift is marked as delivered" — reaches the booking that was active
    // when the wish was gifted, pinned atomically inside the mutation.
    if (notifyReservationId) {
      after(async () => {
        const target = await getReservationNotificationTargetById(
          getDb(),
          notifyReservationId,
        );
        if (target?.email) {
          await sendGiftGiven({
            to: target.email,
            locale: target.locale,
            wishTitle: target.wishTitle,
          });
        }
      });
    }
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok: wish !== null };
}

export async function restoreWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const wish = await restoreWish(getDb(), userId, wishId);
  if (wish) {
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok: wish !== null };
}

/**
 * Permanent delete from the archive (confirmed by dialog). Orphans like any
 * delete, but sends no email: an archived wish was already resolved for the
 * reserver (given, or long settled) — "the owner deleted it" would only
 * confuse.
 */
export async function destroyWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const { result: ok } = await deleteWishAsOwner(getDb(), userId, wishId);
  if (ok) {
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok };
}
