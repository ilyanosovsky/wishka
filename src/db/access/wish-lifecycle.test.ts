// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `deleteWish` comes from `mutations.ts`, which reaches `lib/storage/uploadthing`
// — marked server-only, and that throws outside React's server condition.
vi.mock("server-only", () => ({}));

import type { Db } from "../index";
import { reservations, wishes } from "../schema";
import {
  createGuest,
  createReservation,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { getOwnerWishes } from "./owner";
import { reserveWish } from "./reservations";
import {
  deleteWishAsOwner,
  getReservationNotificationTarget,
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
      await reserveWish(db, wishId, { userId: friendId });

      expect(await deleteWishAsOwner(db, ownerId, wishId)).toBe(true);

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
     * on whether anyone booked the wish. Same value, same follow-up list.
     */
    it("returns the same thing with and without a booking", async () => {
      const free = await createWish(db, { ownerId, title: "Unbooked" });
      const booked = await createWish(db, { ownerId, title: "Booked" });
      await reserveWish(db, booked, { userId: friendId });

      const freeResult = await deleteWishAsOwner(db, ownerId, free);
      const bookedResult = await deleteWishAsOwner(db, ownerId, booked);
      expect(freeResult).toBe(bookedResult);
      expect(bookedResult).toBe(true);

      const remaining = await getOwnerWishes(db, ownerId);
      expect(remaining.some((w) => w.title === "Unbooked")).toBe(false);
      expect(remaining.some((w) => w.title === "Booked")).toBe(false);
    });

    it("returns false the second time, and for a wish the caller does not own", async () => {
      const wishId = await createWish(db, { ownerId, title: "Once only" });
      await reserveWish(db, wishId, { userId: friendId });

      expect(await deleteWishAsOwner(db, ownerId, wishId)).toBe(true);
      expect(await deleteWishAsOwner(db, ownerId, wishId)).toBe(false);
      expect(await deleteWishAsOwner(db, friendId, wishId)).toBe(false);
      expect(await deleteWishAsOwner(db, ownerId, "not-a-uuid")).toBe(false);
    });

    /** A failed delete must not leave the booking marked as orphaned. */
    it("rolls the orphaning back when the delete finds nothing", async () => {
      const wishId = await createWish(db, { ownerId, title: "Not yours" });
      await reserveWish(db, wishId, { userId: friendId });

      expect(await deleteWishAsOwner(db, friendId, wishId)).toBe(false);

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
