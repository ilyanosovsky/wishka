// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { reservations, wishes, wishVisibility } from "../schema";
import {
  createGroup,
  createGuest,
  createReservation,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import {
  cancelReservation,
  dismissReservation,
  orphanActiveReservations,
  reserveWish,
} from "./reservations";

describe("reservations", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let friendA: string;
  let friendB: string;
  let guestId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db);
    friendA = await createUser(db);
    friendB = await createUser(db);
    guestId = await createGuest(db, "device-token");
  });

  afterAll(async () => {
    await ctx.close();
  });

  const newWish = () => createWish(db, { ownerId, title: "Something nice" });

  it("reserves a free wish", async () => {
    const wishId = await newWish();
    const result = await reserveWish(db, wishId, { userId: friendA });
    expect(result.ok).toBe(true);
  });

  it("rejects a second reserver with already_reserved", async () => {
    const wishId = await newWish();
    await reserveWish(db, wishId, { userId: friendA });

    expect(await reserveWish(db, wishId, { userId: friendB })).toEqual({
      ok: false,
      reason: "already_reserved",
    });
    expect(await reserveWish(db, wishId, { guestId })).toEqual({
      ok: false,
      reason: "already_reserved",
    });
  });

  // One PGlite connection serializes these, so this proves the partial unique
  // index rejects the later writers — not true parallelism.
  it("lets the partial unique index reject every reserver after the first", async () => {
    const wishId = await newWish();
    const results = await Promise.all([
      reserveWish(db, wishId, { userId: friendA }),
      reserveWish(db, wishId, { userId: friendB }),
      reserveWish(db, wishId, { guestId }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const failed of results.filter((r) => !r.ok)) {
      expect(failed).toEqual({ ok: false, reason: "already_reserved" });
    }
  });

  it("frees the slot after a cancellation", async () => {
    const wishId = await newWish();
    await reserveWish(db, wishId, { userId: friendA });

    // Only the holder may cancel.
    expect(await cancelReservation(db, wishId, { userId: friendB })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await cancelReservation(db, wishId, { guestId })).toEqual({
      ok: false,
      reason: "not_found",
    });

    expect(await cancelReservation(db, wishId, { userId: friendA })).toEqual({
      ok: true,
    });
    expect(await cancelReservation(db, wishId, { userId: friendA })).toEqual({
      ok: false,
      reason: "not_found",
    });

    const result = await reserveWish(db, wishId, { userId: friendB });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(reservations);
    const forWish = rows.filter((r) => r.wishId === wishId);
    expect(forWish).toHaveLength(2);
    expect(forWish.filter((r) => r.state === "active")).toHaveLength(1);
    expect(
      forWish.find((r) => r.state === "cancelled")?.cancelledAt,
    ).toBeInstanceOf(Date);
  });

  it("reports not_found for unknown, gifted and malformed wishes", async () => {
    expect(
      await reserveWish(db, "00000000-0000-4000-8000-000000000000", {
        userId: friendA,
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    expect(await reserveWish(db, "nope", { userId: friendA })).toEqual({
      ok: false,
      reason: "not_found",
    });

    const giftedId = await createWish(db, {
      ownerId,
      title: "Already gifted",
      status: "gifted",
    });
    expect(await reserveWish(db, giftedId, { userId: friendA })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("turns the owner away from their own wish, revealing nothing", async () => {
    const freeWish = await newWish();
    expect(await reserveWish(db, freeWish, { userId: ownerId })).toEqual({
      ok: false,
      reason: "not_found",
    });

    const heldWish = await newWish();
    expect(await reserveWish(db, heldWish, { userId: friendA })).toMatchObject({
      ok: true,
    });
    // Same answer whether or not a friend holds it: no reservation oracle.
    expect(await reserveWish(db, heldWish, { userId: ownerId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await cancelReservation(db, heldWish, { userId: ownerId })).toEqual({
      ok: false,
      reason: "not_found",
    });

    const stillActive = await db.select().from(reservations);
    expect(
      stillActive.filter((r) => r.wishId === heldWish && r.state === "active"),
    ).toHaveLength(1);
  });

  it("refuses to reserve a wish the reserver cannot see", async () => {
    const groupId = await createGroup(db, ownerId, [ownerId, friendA]);
    const wishId = await createWish(db, {
      ownerId,
      title: "Restricted",
      visibility: "restricted",
    });
    await db
      .insert(wishVisibility)
      .values({ wishId, subjectType: "group", subjectId: groupId });

    expect(await reserveWish(db, wishId, { userId: friendB })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await reserveWish(db, wishId, { guestId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await reserveWish(db, wishId, { userId: friendA })).toMatchObject({
      ok: true,
    });
  });

  it("still lets a reserver cancel after losing access to the wish", async () => {
    const wishId = await createWish(db, { ownerId, title: "Narrowed later" });
    expect(await reserveWish(db, wishId, { userId: friendA })).toMatchObject({
      ok: true,
    });

    // The owner narrows the audience; the booking survives and stays cancellable.
    await db
      .update(wishes)
      .set({ visibility: "restricted" })
      .where(eq(wishes.id, wishId));

    expect(await cancelReservation(db, wishId, { userId: friendA })).toEqual({
      ok: true,
    });
  });

  it("requires exactly one reserver identity at the database level", async () => {
    const wishId = await newWish();
    const base = {
      wishId,
      listOwnerId: ownerId,
      wishTitle: "Something nice",
      state: "active" as const,
    };
    await expect(db.insert(reservations).values(base)).rejects.toThrow();
    await expect(
      db
        .insert(reservations)
        .values({ ...base, reserverUserId: friendA, guestId }),
    ).rejects.toThrow();
  });

  it("snapshots the wish and the reserver's locale on the row", async () => {
    const wishId = await createWish(db, {
      ownerId,
      title: "Espresso machine",
      url: "https://example.test/machine",
      priceType: "range",
      priceMin: "100.00",
      priceMax: "250.00",
      currency: "EUR",
    });
    const result = await reserveWish(
      db,
      wishId,
      { userId: friendA },
      {
        locale: "en",
      },
    );
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.wishId, wishId));
    expect(row).toMatchObject({
      listOwnerId: ownerId,
      wishTitle: "Espresso machine",
      wishUrl: "https://example.test/machine",
      wishPriceType: "range",
      wishPriceMin: "100.00",
      wishPriceMax: "250.00",
      wishCurrency: "EUR",
      locale: "en",
    });
  });

  it("defaults the locale to ru", async () => {
    const wishId = await newWish();
    await reserveWish(db, wishId, { userId: friendA });

    const [row] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.wishId, wishId));
    expect(row.locale).toBe("ru");
  });

  it("keeps the snapshot when the owner rewrites the wish", async () => {
    const wishId = await createWish(db, { ownerId, title: "Original title" });
    await reserveWish(db, wishId, { userId: friendA });
    await db
      .update(wishes)
      .set({ title: "Rewritten" })
      .where(eq(wishes.id, wishId));

    const [row] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.wishId, wishId));
    expect(row.wishTitle).toBe("Original title");
  });

  describe("orphanActiveReservations", () => {
    it("marks the active booking and leaves the snapshot intact", async () => {
      const wishId = await createWish(db, { ownerId, title: "Doomed gift" });
      await reserveWish(db, wishId, { userId: friendA });

      await orphanActiveReservations(db, wishId, ownerId);

      const [row] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.wishId, wishId));
      expect(row.state).toBe("orphaned");
      expect(row.orphanedAt).toBeInstanceOf(Date);
      expect(row.wishTitle).toBe("Doomed gift");
    });

    it("does nothing for a wish someone else owns, or a malformed id", async () => {
      const wishId = await newWish();
      await reserveWish(db, wishId, { userId: friendA });

      await orphanActiveReservations(db, wishId, friendB);
      await orphanActiveReservations(db, "not-a-uuid", ownerId);

      const [row] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.wishId, wishId));
      expect(row.state).toBe("active");
      expect(row.orphanedAt).toBeNull();
    });

    it("leaves cancelled rows alone", async () => {
      const wishId = await newWish();
      await reserveWish(db, wishId, { userId: friendA });
      await cancelReservation(db, wishId, { userId: friendA });

      await orphanActiveReservations(db, wishId, ownerId);

      const [row] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.wishId, wishId));
      expect(row.state).toBe("cancelled");
    });
  });

  describe("dismissReservation", () => {
    it("cancels an orphaned row whose wish is already gone", async () => {
      const reservationId = await createReservation(db, {
        wishId: null,
        listOwnerId: ownerId,
        wishTitle: "Gone forever",
        reserverUserId: friendA,
        state: "orphaned",
        orphanedAt: new Date(),
      });

      expect(
        await dismissReservation(db, reservationId, { userId: friendA }),
      ).toEqual({ ok: true });

      const [row] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId));
      expect(row.state).toBe("cancelled");
      expect(row.cancelledAt).toBeInstanceOf(Date);
    });

    it("cancels a live booking by reservation id", async () => {
      const wishId = await newWish();
      const result = await reserveWish(db, wishId, { guestId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(
        await dismissReservation(db, result.reservationId, { guestId }),
      ).toEqual({ ok: true });
      // The slot is free again.
      expect(await reserveWish(db, wishId, { userId: friendA })).toMatchObject({
        ok: true,
      });
    });

    it("refuses a stranger's reservation, an unknown id and a repeat", async () => {
      const wishId = await newWish();
      const result = await reserveWish(db, wishId, { userId: friendA });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(
        await dismissReservation(db, result.reservationId, { userId: friendB }),
      ).toEqual({ ok: false, reason: "not_found" });
      expect(
        await dismissReservation(db, result.reservationId, { guestId }),
      ).toEqual({ ok: false, reason: "not_found" });
      expect(
        await dismissReservation(db, "00000000-0000-4000-8000-000000000000", {
          userId: friendA,
        }),
      ).toEqual({ ok: false, reason: "not_found" });
      expect(await dismissReservation(db, "nope", { userId: friendA })).toEqual(
        {
          ok: false,
          reason: "not_found",
        },
      );

      expect(
        await dismissReservation(db, result.reservationId, { userId: friendA }),
      ).toEqual({ ok: true });
      expect(
        await dismissReservation(db, result.reservationId, { userId: friendA }),
      ).toEqual({ ok: false, reason: "not_found" });
    });
  });
});
