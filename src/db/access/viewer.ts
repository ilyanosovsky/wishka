import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "../index";
import { reservations, wishes } from "../schema";
import { isUuid } from "./ids";
import type { ReservationStatus, Viewer, ViewerWish } from "./types";

/**
 * Viewer-facing reads: someone else's list, seen through the visibility rules.
 *
 * This is the only module allowed to join wishes to reservation rows, and two
 * paths deliberately skip that join: the list owner reading their own list, and
 * the "see how others see it" preview. Both go through `selectVisible`, which
 * cannot reach reservation data at all.
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
  createdAt: wishes.createdAt,
};

function viewerUserId(viewer: Viewer): string | null {
  return "userId" in viewer ? viewer.userId : null;
}

function viewerGuestId(viewer: Viewer): string | null {
  return "guestId" in viewer && isUuid(viewer.guestId) ? viewer.guestId : null;
}

/**
 * `everyone` wishes are public. `restricted` wishes require a signed-in viewer
 * named directly in wish_visibility, or sharing a group with the owner — guests
 * and anonymous visitors can never reach them.
 *
 * Exported so that reserving a wish is gated by the same rule that shows it.
 */
export function visibleTo(viewer: Viewer): SQL {
  const isPublic = eq(wishes.visibility, "everyone");
  const userId = viewerUserId(viewer);
  if (!userId) return isPublic;

  const restrictedToViewer = sql`exists (
    select 1 from "wish_visibility" wv
    where wv."wish_id" = ${wishes.id}
      and (
        (wv."subject_type" = 'user' and wv."subject_id" = ${userId})
        or (
          wv."subject_type" = 'group'
          and exists (
            select 1
            from "group_members" gm_viewer
            join "group_members" gm_owner
              on gm_owner."group_id" = gm_viewer."group_id"
            where gm_viewer."group_id"::text = wv."subject_id"
              and gm_viewer."user_id" = ${userId}
              and gm_owner."user_id" = ${wishes.ownerId}
          )
        )
      )
  )`;

  // `or` of two defined conditions is always defined.
  return or(isPublic, restrictedToViewer) as SQL;
}

/** The visible slice of a list, with no access to reservation rows. */
async function selectVisible(
  db: Db,
  listOwnerId: string,
  viewer: Viewer,
): Promise<Omit<ViewerWish, "reservationStatus">[]> {
  return db
    .select(columns)
    .from(wishes)
    .where(
      and(
        eq(wishes.ownerId, listOwnerId),
        eq(wishes.status, "active"),
        visibleTo(viewer),
      ),
    )
    .orderBy(desc(wishes.createdAt), desc(wishes.id));
}

function isListOwner(listOwnerId: string, viewer: Viewer): boolean {
  return "userId" in viewer && viewer.userId === listOwnerId;
}

/**
 * "Посмотреть, как видят другие" — replays the visibility rules for a simulated
 * viewer while the *owner* is the one looking at the screen. Every wish comes
 * back as `free`: the preview must never become a back door onto reservations.
 */
export async function getWishesAsSeenBy(
  db: Db,
  ownerId: string,
  simulatedViewer: Viewer,
): Promise<ViewerWish[]> {
  const rows = await selectVisible(db, ownerId, simulatedViewer);
  return rows.map((wish) => ({
    ...wish,
    reservationStatus: "free" as const,
  }));
}

export async function getVisibleWishes(
  db: Db,
  listOwnerId: string,
  viewer: Viewer,
): Promise<ViewerWish[]> {
  // The owner reading their own list gets the reservation-free query, not a
  // filtered result — nothing to leak if the join never happens.
  if (isListOwner(listOwnerId, viewer)) {
    return getWishesAsSeenBy(db, listOwnerId, viewer);
  }

  const userId = viewerUserId(viewer);
  const guestId = viewerGuestId(viewer);

  const rows = await db
    .select({
      ...columns,
      heldByUserId: reservations.reserverUserId,
      heldByGuestId: reservations.guestId,
    })
    .from(wishes)
    .leftJoin(
      reservations,
      and(eq(reservations.wishId, wishes.id), eq(reservations.state, "active")),
    )
    .where(
      and(
        eq(wishes.ownerId, listOwnerId),
        eq(wishes.status, "active"),
        visibleTo(viewer),
      ),
    )
    .orderBy(desc(wishes.createdAt), desc(wishes.id));

  return rows.map(({ heldByUserId, heldByGuestId, ...wish }) => {
    let reservationStatus: ReservationStatus = "free";
    if (heldByUserId !== null || heldByGuestId !== null) {
      const isMine =
        (userId !== null && heldByUserId === userId) ||
        (guestId !== null && heldByGuestId === guestId);
      reservationStatus = isMine ? "reserved_by_you" : "reserved";
    }
    return { ...wish, reservationStatus };
  });
}
