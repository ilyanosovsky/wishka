// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `deleteWish` comes from `mutations.ts`, which reaches `lib/storage/uploadthing`
// — marked server-only, and that throws outside React's server condition.
vi.mock("server-only", () => ({}));

import type { Db } from "../index";
import { groupMembers, reservations, wishes } from "../schema";
import {
  createGroup,
  createGuest,
  createReservation,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { getOwnerWish, getOwnerWishes } from "./owner";
import { reserveWish } from "./reservations";
import type { WishAudience } from "./visibility";
import {
  deleteWishAsOwner,
  getReservationNotificationTarget,
  updateWishAsOwner,
} from "./wish-lifecycle";

describe("wish lifecycle", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let friendId: string;
  let guestId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db, { name: "Ilya" });
    friendId = await createUser(db, {
      name: "Masha",
      email: "masha@example.test",
    });
    guestId = await createGuest(db, "lifecycle-token", {
      name: "Petya",
      email: "petya@example.test",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("deleteWishAsOwner", () => {
    it("orphans the booking and keeps its snapshot", async () => {
      const wishId = await createWish(db, {
        ownerId,
        title: "Doomed gift",
        url: "https://example.test/doomed",
      });
      const reservation = await reserveWish(db, wishId, { userId: friendId });
      if (!reservation.ok) throw new Error("setup failed");

      const outcome = await deleteWishAsOwner(db, ownerId, wishId);
      expect(outcome.result).toBe(true);
      // The booking active at delete time is captured for the "wish deleted"
      // email — pinned by id, atomically inside the delete transaction.
      expect(outcome.notifyReservationId).toBe(reservation.reservationId);

      const [row] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.wishTitle, "Doomed gift"));
      expect(row.wishId).toBeNull();
      expect(row.state).toBe("orphaned");
      expect(row.orphanedAt).toBeInstanceOf(Date);
      expect(row.wishUrl).toBe("https://example.test/doomed");
      expect(row.listOwnerId).toBe(ownerId);
    });

    /**
     * SURPRISE INVARIANT — the owner-visible result of a delete must not depend
     * on whether anyone booked the wish. `notifyReservationId` is captured for
     * `after()` and is never returned to the owner, so it may differ; `result`,
     * the value the owner sees, must not.
     */
    it("returns the same owner-visible result with and without a booking", async () => {
      const free = await createWish(db, { ownerId, title: "Unbooked" });
      const booked = await createWish(db, { ownerId, title: "Booked" });
      await reserveWish(db, booked, { userId: friendId });

      const freeResult = await deleteWishAsOwner(db, ownerId, free);
      const bookedResult = await deleteWishAsOwner(db, ownerId, booked);
      expect(freeResult.result).toBe(bookedResult.result);
      expect(bookedResult.result).toBe(true);
      expect(freeResult.notifyReservationId).toBeNull();
      expect(bookedResult.notifyReservationId).not.toBeNull();

      const remaining = await getOwnerWishes(db, ownerId);
      expect(remaining.some((w) => w.title === "Unbooked")).toBe(false);
      expect(remaining.some((w) => w.title === "Booked")).toBe(false);
    });

    it("returns false the second time, and for a wish the caller does not own", async () => {
      const wishId = await createWish(db, { ownerId, title: "Once only" });
      await reserveWish(db, wishId, { userId: friendId });

      expect((await deleteWishAsOwner(db, ownerId, wishId)).result).toBe(true);
      expect((await deleteWishAsOwner(db, ownerId, wishId)).result).toBe(false);
      expect((await deleteWishAsOwner(db, friendId, wishId)).result).toBe(
        false,
      );
      expect((await deleteWishAsOwner(db, ownerId, "not-a-uuid")).result).toBe(
        false,
      );
    });

    /** A failed delete must not leave the booking marked as orphaned. */
    it("rolls the orphaning back when the delete finds nothing", async () => {
      const wishId = await createWish(db, { ownerId, title: "Not yours" });
      await reserveWish(db, wishId, { userId: friendId });

      expect((await deleteWishAsOwner(db, friendId, wishId)).result).toBe(
        false,
      );

      const [row] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.wishId, wishId));
      expect(row.state).toBe("active");
      expect(row.orphanedAt).toBeNull();
      // The wish itself is untouched.
      const [wish] = await db
        .select()
        .from(wishes)
        .where(eq(wishes.id, wishId));
      expect(wish.title).toBe("Not yours");
    });
  });

  /**
   * «Кому видно» is the one edit that can take a booked wish away from the
   * person holding it. `reserverLostAccess` is how the caller learns to send
   * the "no longer visible" email instead of the "changed" one — and, like
   * `notifyReservationId`, it is for `after()` and nothing else.
   */
  describe("updateWishAsOwner and the audience", () => {
    /** A group the owner shares with nobody who books anything here. */
    let closedGroupId: string;
    /** A group the owner shares with the reserving friend. */
    let friendGroupId: string;

    const narrowTo = (groupId: string): WishAudience => ({
      mode: "restricted",
      groupIds: [groupId],
      userIds: [],
    });

    beforeAll(async () => {
      const outsider = await createUser(db, { name: "Outsider" });
      closedGroupId = await createGroup(db, ownerId, [ownerId, outsider]);
      friendGroupId = await createGroup(db, ownerId, [ownerId, friendId]);
    });

    it("reports a signed-in holder losing sight of the wish", async () => {
      const wishId = await createWish(db, { ownerId, title: "Narrowed away" });
      await reserveWish(db, wishId, { userId: friendId });

      const outcome = await updateWishAsOwner(
        db,
        ownerId,
        wishId,
        {},
        narrowTo(closedGroupId),
      );
      expect(outcome.reserverLostAccess).toBe(true);
      expect(outcome.notifyReservationId).not.toBeNull();
      if (!outcome.result.ok) throw new Error("expected the update to succeed");
      expect(outcome.result.wish.visibility).toBe("restricted");
    });

    it("reports a guest holder losing sight of any narrowing at all", async () => {
      const wishId = await createWish(db, { ownerId, title: "Guest booked" });
      await reserveWish(db, wishId, { guestId });

      // A guest can only ever reach `everyone` wishes, so even an audience the
      // guest's own would-be group is in cuts them off.
      const outcome = await updateWishAsOwner(
        db,
        ownerId,
        wishId,
        {},
        narrowTo(friendGroupId),
      );
      expect(outcome.reserverLostAccess).toBe(true);
    });

    it("stays false when the holder is still in the audience", async () => {
      const wishId = await createWish(db, { ownerId, title: "Still visible" });
      await reserveWish(db, wishId, { userId: friendId });

      const outcome = await updateWishAsOwner(
        db,
        ownerId,
        wishId,
        { title: "Still visible, renamed" },
        narrowTo(friendGroupId),
      );
      expect(outcome.reserverLostAccess).toBe(false);
      expect(outcome.notifyReservationId).not.toBeNull();
    });

    /**
     * It reports the transition, not the state. A wish the holder already
     * cannot see loses them nothing when it is edited again — re-firing would
     * repeat "the wish is no longer visible to you" on every later save, and
     * (see the caller) swallow the "the wish changed" email they should get.
     */
    it("fires once for the edit that narrowed, not for later ones", async () => {
      const wishId = await createWish(db, { ownerId, title: "Narrowed once" });
      await reserveWish(db, wishId, { userId: friendId });

      const narrowed = await updateWishAsOwner(
        db,
        ownerId,
        wishId,
        {},
        narrowTo(closedGroupId),
      );
      expect(narrowed.reserverLostAccess).toBe(true);

      const renamed = await updateWishAsOwner(db, ownerId, wishId, {
        title: "Narrowed once, renamed",
      });
      expect(renamed.reserverLostAccess).toBe(false);
      expect(renamed.notifyReservationId).not.toBeNull();
      if (!renamed.result.ok) throw new Error("expected the update to succeed");
      expect(renamed.result.wish.visibility).toBe("restricted");
    });

    /**
     * And it is about what the *owner* did. A holder who walked out of the
     * audience themselves must not turn the owner's next unrelated edit into
     * "the owner hid this from you".
     */
    it("stays false when the holder left the audience themselves", async () => {
      const groupId = await createGroup(db, ownerId, [ownerId, friendId]);
      const wishId = await createWish(db, { ownerId, title: "Left behind" });
      await reserveWish(db, wishId, { userId: friendId });

      const narrowed = await updateWishAsOwner(
        db,
        ownerId,
        wishId,
        {},
        narrowTo(groupId),
      );
      expect(narrowed.reserverLostAccess).toBe(false);

      await db
        .delete(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.userId, friendId),
          ),
        );

      const renamed = await updateWishAsOwner(db, ownerId, wishId, {
        title: "Left behind, renamed",
      });
      expect(renamed.reserverLostAccess).toBe(false);
      expect(renamed.notifyReservationId).not.toBeNull();
    });

    it("stays false for an edit that leaves an everyone-wish alone", async () => {
      const wishId = await createWish(db, { ownerId, title: "Just renamed" });
      await reserveWish(db, wishId, { userId: friendId });

      const outcome = await updateWishAsOwner(db, ownerId, wishId, {
        title: "Renamed only",
      });
      expect(outcome.reserverLostAccess).toBe(false);
      if (!outcome.result.ok) throw new Error("expected the update to succeed");
      expect(outcome.result.wish.visibility).toBe("everyone");
    });

    /**
     * SURPRISE INVARIANT — same test as the delete one above, for the edit that
     * *can* differ: narrowing a wish somebody booked. `reserverLostAccess` and
     * `notifyReservationId` are `after()`-only and may differ; `result`, the
     * only thing the owner sees, must be identical field for field.
     */
    it("returns the same owner-visible result with and without a booking", async () => {
      const free = await createWish(db, { ownerId, title: "Twin" });
      const booked = await createWish(db, { ownerId, title: "Twin" });
      await reserveWish(db, booked, { userId: friendId });

      const patch = { title: "Twin, narrowed" };
      const freeOutcome = await updateWishAsOwner(
        db,
        ownerId,
        free,
        patch,
        narrowTo(closedGroupId),
      );
      const bookedOutcome = await updateWishAsOwner(
        db,
        ownerId,
        booked,
        patch,
        narrowTo(closedGroupId),
      );

      // Everything but the identity of the row and its timestamps, which are
      // per-row by construction and say nothing about bookings.
      const comparable = (outcome: typeof freeOutcome) => {
        if (!outcome.result.ok) throw new Error("expected a saved wish");
        const wish: Record<string, unknown> = { ...outcome.result.wish };
        for (const key of ["id", "createdAt", "updatedAt"]) delete wish[key];
        return wish;
      };
      expect(Object.keys(comparable(bookedOutcome)).sort()).toEqual(
        Object.keys(comparable(freeOutcome)).sort(),
      );
      expect(comparable(bookedOutcome)).toEqual(comparable(freeOutcome));

      expect(freeOutcome.notifyReservationId).toBeNull();
      expect(freeOutcome.reserverLostAccess).toBe(false);
      expect(bookedOutcome.notifyReservationId).not.toBeNull();
      expect(bookedOutcome.reserverLostAccess).toBe(true);
    });

    it("unwinds the edit when the audience is refused", async () => {
      const wishId = await createWish(db, { ownerId, title: "Kept as it was" });
      await reserveWish(db, wishId, { userId: friendId });

      const outcome = await updateWishAsOwner(
        db,
        ownerId,
        wishId,
        { title: "Should not stick" },
        { mode: "restricted", groupIds: [], userIds: [] },
      );
      expect(outcome.result).toEqual({ ok: false, error: "empty_audience" });
      expect(outcome.notifyReservationId).toBeNull();
      expect(outcome.reserverLostAccess).toBe(false);
      expect(outcome.before?.title).toBe("Kept as it was");

      expect((await getOwnerWish(db, ownerId, wishId))?.title).toBe(
        "Kept as it was",
      );
    });

    it("refuses a wish the caller does not own without an audience write", async () => {
      const wishId = await createWish(db, { ownerId, title: "Not yours" });
      const outcome = await updateWishAsOwner(
        db,
        friendId,
        wishId,
        { title: "Hijacked" },
        narrowTo(friendGroupId),
      );
      expect(outcome.result).toEqual({ ok: false, error: "not_found" });
      expect(outcome.reserverLostAccess).toBe(false);
      expect((await getOwnerWish(db, ownerId, wishId))?.visibility).toBe(
        "everyone",
      );
    });
  });

  describe("getReservationNotificationTarget", () => {
    it("resolves a signed-in reserver", async () => {
      const wishId = await createWish(db, { ownerId, title: "For Masha" });
      const result = await reserveWish(
        db,
        wishId,
        { userId: friendId },
        { locale: "en" },
      );
      if (!result.ok) throw new Error("setup failed");

      expect(await getReservationNotificationTarget(db, wishId)).toEqual({
        reservationId: result.reservationId,
        email: "masha@example.test",
        name: "Masha",
        locale: "en",
        isGuest: false,
        guestId: null,
        guestToken: null,
        wishTitle: "For Masha",
      });
    });

    it("resolves a guest, carrying the token the manage link needs", async () => {
      const wishId = await createWish(db, { ownerId, title: "For Petya" });
      const result = await reserveWish(db, wishId, { guestId });
      if (!result.ok) throw new Error("setup failed");

      expect(await getReservationNotificationTarget(db, wishId)).toEqual({
        reservationId: result.reservationId,
        email: "petya@example.test",
        name: "Petya",
        locale: "ru",
        isGuest: true,
        guestId,
        guestToken: "lifecycle-token",
        wishTitle: "For Petya",
      });
    });

    it("reports a guest who never left an address", async () => {
      const silentGuest = await createGuest(db, "silent-token", {
        name: "Silent",
      });
      const wishId = await createWish(db, { ownerId, title: "No address" });
      await reserveWish(db, wishId, { guestId: silentGuest });

      const target = await getReservationNotificationTarget(db, wishId);
      expect(target?.email).toBeNull();
      expect(target?.name).toBe("Silent");
    });

    it("names the wish as it was booked, not as it was renamed", async () => {
      const wishId = await createWish(db, { ownerId, title: "As booked" });
      await reserveWish(db, wishId, { userId: friendId });
      await db
        .update(wishes)
        .set({ title: "Renamed since" })
        .where(eq(wishes.id, wishId));

      expect(
        (await getReservationNotificationTarget(db, wishId))?.wishTitle,
      ).toBe("As booked");
    });

    it("returns null when there is nobody to notify", async () => {
      const free = await createWish(db, { ownerId, title: "Nobody booked it" });
      expect(await getReservationNotificationTarget(db, free)).toBeNull();
      expect(
        await getReservationNotificationTarget(db, "not-a-uuid"),
      ).toBeNull();
      expect(
        await getReservationNotificationTarget(
          db,
          "00000000-0000-4000-8000-000000000000",
        ),
      ).toBeNull();

      // A booking that is no longer live is nobody to notify either.
      const orphaned = await createWish(db, { ownerId, title: "Already dead" });
      await createReservation(db, {
        wishId: orphaned,
        listOwnerId: ownerId,
        wishTitle: "Already dead",
        reserverUserId: friendId,
        state: "cancelled",
        cancelledAt: new Date(),
      });
      expect(await getReservationNotificationTarget(db, orphaned)).toBeNull();
    });
  });
});
