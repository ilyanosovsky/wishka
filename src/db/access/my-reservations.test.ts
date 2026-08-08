// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { profiles, wishes } from "../schema";
import {
  createGuest,
  createReservation,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { getMyReservations } from "./my-reservations";
import {
  cancelReservation,
  orphanActiveReservations,
  reserveWish,
} from "./reservations";

describe("my reservations", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let friendId: string;
  let strangerId: string;
  let guestId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db, { name: "Ilya", image: "avatar.png" });
    friendId = await createUser(db);
    strangerId = await createUser(db);
    guestId = await createGuest(db, "my-reservations-token");
    await db
      .insert(profiles)
      .values({ userId: ownerId, nickname: "ilya", baseCurrency: "EUR" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Every test books its own wish, so the rows never collide. */
  async function bookFresh(
    values: Partial<typeof wishes.$inferInsert> = {},
  ): Promise<string> {
    const wishId = await createWish(db, {
      ownerId,
      title: "Something nice",
      ...values,
    });
    const result = await reserveWish(db, wishId, { userId: friendId });
    if (!result.ok) throw new Error("setup failed");
    return wishId;
  }

  async function forWish(wishId: string) {
    const rows = await getMyReservations(db, { userId: friendId });
    return rows.find((row) => row.wishId === wishId);
  }

  it("reports an untouched booking as active, with the list owner attached", async () => {
    const wishId = await bookFresh({
      title: "Kettle",
      url: "https://example.test/kettle",
      imageKey: "https://utfs.io/f/kettle.jpg",
      priceType: "exact",
      priceMin: "42.00",
      currency: "EUR",
    });

    const row = await forWish(wishId);
    expect(row).toMatchObject({
      state: "active",
      changedFields: [],
      title: "Kettle",
      reservedTitle: "Kettle",
      url: "https://example.test/kettle",
      imageKey: "https://utfs.io/f/kettle.jpg",
      priceType: "exact",
      priceMin: "42.00",
      currency: "EUR",
      owner: {
        userId: ownerId,
        name: "Ilya",
        nickname: "ilya",
        image: "avatar.png",
      },
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("names every field the owner edited after the booking", async () => {
    const wishId = await bookFresh({
      title: "Old title",
      url: "https://example.test/old",
      priceType: "exact",
      priceMin: "10.00",
      currency: "EUR",
    });
    await db
      .update(wishes)
      .set({
        title: "New title",
        url: "https://example.test/new",
        priceMin: "20.00",
      })
      .where(eq(wishes.id, wishId));

    const row = await forWish(wishId);
    expect(row?.state).toBe("changed");
    expect(row?.changedFields.sort()).toEqual(["price", "title", "url"]);
    // The card shows the current wish, and remembers what it was called.
    expect(row?.title).toBe("New title");
    expect(row?.reservedTitle).toBe("Old title");
    expect(row?.priceMin).toBe("20.00");
  });

  it("reports a price-only edit without touching the other fields", async () => {
    const wishId = await bookFresh({
      priceType: "exact",
      priceMin: "10.00",
      currency: "EUR",
    });
    await db
      .update(wishes)
      .set({ priceType: "range", priceMax: "30.00" })
      .where(eq(wishes.id, wishId));

    const row = await forWish(wishId);
    expect(row?.state).toBe("changed");
    expect(row?.changedFields).toEqual(["price"]);
  });

  it("reports a currency swap as a price change", async () => {
    const wishId = await bookFresh({
      priceType: "exact",
      priceMin: "10.00",
      currency: "EUR",
    });
    await db
      .update(wishes)
      .set({ currency: "USD" })
      .where(eq(wishes.id, wishId));

    expect((await forWish(wishId))?.changedFields).toEqual(["price"]);
  });

  it("falls back to the snapshot once the wish is gone", async () => {
    const wishId = await bookFresh({
      title: "Vanishing act",
      url: "https://example.test/vanishing",
      imageKey: "https://utfs.io/f/vanishing.jpg",
      priceType: "exact",
      priceMin: "99.00",
      currency: "EUR",
    });
    await orphanActiveReservations(db, wishId, ownerId);
    await db.delete(wishes).where(eq(wishes.id, wishId));

    const rows = await getMyReservations(db, { userId: friendId });
    const row = rows.find((r) => r.reservedTitle === "Vanishing act");
    expect(row).toMatchObject({
      wishId: null,
      state: "deleted",
      changedFields: [],
      title: "Vanishing act",
      url: "https://example.test/vanishing",
      imageKey: null,
      priceType: "exact",
      priceMin: "99.00",
      currency: "EUR",
    });
  });

  it("reads a still-active row with no wish as deleted too", async () => {
    // The race artifact: the wish went away without the orphaning step.
    await createReservation(db, {
      wishId: null,
      listOwnerId: ownerId,
      wishTitle: "Raced away",
      reserverUserId: friendId,
      state: "active",
    });

    const rows = await getMyReservations(db, { userId: friendId });
    expect(rows.find((r) => r.reservedTitle === "Raced away")?.state).toBe(
      "deleted",
    );
  });

  it("reports a gifted wish as given, even when it was also edited", async () => {
    const wishId = await bookFresh({ title: "Handed over" });
    await db
      .update(wishes)
      .set({ status: "gifted", title: "Handed over (edited)" })
      .where(eq(wishes.id, wishId));

    const row = await forWish(wishId);
    expect(row?.state).toBe("given");
    expect(row?.changedFields).toEqual([]);
  });

  it("shows only the caller's own live rows", async () => {
    const guestWish = await createWish(db, { ownerId, title: "Guest booking" });
    await reserveWish(db, guestWish, { guestId });
    const cancelledWish = await bookFresh({ title: "Given up" });
    await cancelReservation(db, cancelledWish, { userId: friendId });

    const mine = await getMyReservations(db, { userId: friendId });
    expect(mine.some((r) => r.wishId === guestWish)).toBe(false);
    expect(mine.some((r) => r.wishId === cancelledWish)).toBe(false);

    const guestRows = await getMyReservations(db, { guestId });
    expect(guestRows.map((r) => r.wishId)).toEqual([guestWish]);

    expect(await getMyReservations(db, { userId: strangerId })).toEqual([]);
  });

  it("returns nothing for a malformed guest id", async () => {
    expect(await getMyReservations(db, { guestId: "not-a-uuid" })).toEqual([]);
  });

  it("sorts newest first", async () => {
    const rows = await getMyReservations(db, { userId: friendId });
    const times = rows.map((r) => r.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("still lists a booking the reserver can no longer see", async () => {
    const wishId = await bookFresh({ title: "Narrowed away" });
    await db
      .update(wishes)
      .set({ visibility: "restricted" })
      .where(eq(wishes.id, wishId));

    expect((await forWish(wishId))?.state).toBe("active");
  });
});
