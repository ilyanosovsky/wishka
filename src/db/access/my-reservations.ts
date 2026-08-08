import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "../index";
import { profiles, reservations, user, wishes } from "../schema";
import { hasUsableIdentity, reserverMatch } from "./reservations";
import type { Reserver, WishPriceType } from "./types";

/**
 * "My bookings" — the reserver's own side of the surprise.
 *
 * This is the mirror image of `owner.ts`: it reads reservation rows freely,
 * because every row here belongs to the caller. It is scoped by reserver
 * identity and never by list, so it cannot be turned into a view of someone
 * else's bookings.
 *
 * NO VISIBILITY RE-CHECK, on purpose. The wish was visible when it was booked;
 * if the owner has since narrowed the audience, the holder must still see what
 * they committed to buy and be able to release it. Only the reservation's own
 * snapshot and the fields already shown on the card are exposed.
 */

export type ReservationChangedField = "title" | "price" | "url";

export type MyReservationState = "active" | "changed" | "deleted" | "given";

export type MyReservation = {
  /** The reservation id — the handle "убрать" / "снять бронь" acts on. */
  id: string;
  wishId: string | null;
  state: MyReservationState;
  /** Non-empty only when `state === "changed"`. */
  changedFields: ReservationChangedField[];
  title: string;
  /** What the wish was called at reserve time — «было: …» on a changed card. */
  reservedTitle: string;
  url: string | null;
  imageKey: string | null;
  priceType: WishPriceType;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  owner: {
    userId: string;
    name: string;
    nickname: string | null;
    image: string | null;
  };
  createdAt: Date;
};

function priceChanged(
  snapshot: {
    priceType: WishPriceType;
    priceMin: string | null;
    priceMax: string | null;
    currency: string | null;
  },
  current: {
    priceType: WishPriceType;
    priceMin: string | null;
    priceMax: string | null;
    currency: string | null;
  },
): boolean {
  return (
    snapshot.priceType !== current.priceType ||
    snapshot.priceMin !== current.priceMin ||
    snapshot.priceMax !== current.priceMax ||
    snapshot.currency !== current.currency
  );
}

export async function getMyReservations(
  db: Db,
  reserver: Reserver,
): Promise<MyReservation[]> {
  if (!hasUsableIdentity(reserver)) return [];

  const rows = await db
    .select({
      id: reservations.id,
      wishId: reservations.wishId,
      reservationState: reservations.state,
      createdAt: reservations.createdAt,
      snapshotTitle: reservations.wishTitle,
      snapshotUrl: reservations.wishUrl,
      snapshotPriceType: reservations.wishPriceType,
      snapshotPriceMin: reservations.wishPriceMin,
      snapshotPriceMax: reservations.wishPriceMax,
      snapshotCurrency: reservations.wishCurrency,
      currentTitle: wishes.title,
      currentUrl: wishes.url,
      currentImageKey: wishes.imageKey,
      currentPriceType: wishes.priceType,
      currentPriceMin: wishes.priceMin,
      currentPriceMax: wishes.priceMax,
      currentCurrency: wishes.currency,
      currentStatus: wishes.status,
      ownerUserId: reservations.listOwnerId,
      ownerName: user.name,
      ownerImage: user.image,
      ownerNickname: profiles.nickname,
    })
    .from(reservations)
    .leftJoin(wishes, eq(wishes.id, reservations.wishId))
    .innerJoin(user, eq(user.id, reservations.listOwnerId))
    .leftJoin(profiles, eq(profiles.userId, reservations.listOwnerId))
    .where(
      and(
        inArray(reservations.state, ["active", "orphaned"]),
        reserverMatch(reserver),
      ),
    )
    .orderBy(desc(reservations.createdAt), desc(reservations.id));

  return rows.map((row) => {
    // A live wish is one the left join actually found. `active` with no wish is
    // the benign race artifact of a delete that skipped `orphanActiveReservations`
    // — read it as deleted, same as an explicitly orphaned row.
    const deleted =
      row.currentTitle === null || row.reservationState === "orphaned";

    const snapshot = {
      priceType: row.snapshotPriceType,
      priceMin: row.snapshotPriceMin,
      priceMax: row.snapshotPriceMax,
      currency: row.snapshotCurrency,
    };
    const current = {
      priceType: row.currentPriceType ?? snapshot.priceType,
      priceMin: row.currentPriceMin,
      priceMax: row.currentPriceMax,
      currency: row.currentCurrency,
    };

    const owner = {
      userId: row.ownerUserId,
      name: row.ownerName,
      nickname: row.ownerNickname,
      image: row.ownerImage,
    };

    if (deleted) {
      return {
        id: row.id,
        wishId: row.wishId,
        state: "deleted" as const,
        changedFields: [],
        title: row.snapshotTitle,
        reservedTitle: row.snapshotTitle,
        url: row.snapshotUrl,
        imageKey: null,
        ...snapshot,
        owner,
        createdAt: row.createdAt,
      };
    }

    const changedFields: ReservationChangedField[] = [];
    if (row.snapshotTitle !== row.currentTitle) changedFields.push("title");
    if (priceChanged(snapshot, current)) changedFields.push("price");
    if (row.snapshotUrl !== row.currentUrl) changedFields.push("url");

    // "Уже подарили" wins over a diff: the booking is settled either way, and
    // reporting edits on a closed wish is noise.
    let state: MyReservationState = "active";
    if (row.currentStatus === "gifted") {
      state = "given";
    } else if (changedFields.length > 0) {
      state = "changed";
    }

    return {
      id: row.id,
      wishId: row.wishId,
      state,
      changedFields: state === "changed" ? changedFields : [],
      title: row.currentTitle ?? row.snapshotTitle,
      reservedTitle: row.snapshotTitle,
      url: row.currentUrl,
      imageKey: row.currentImageKey,
      ...current,
      owner,
      createdAt: row.createdAt,
    };
  });
}
