// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { wishVisibility } from "../schema";
import {
  createGroup,
  createGuest,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { reserveWish } from "./reservations";
import { getVisibleWish, getVisibleWishes, getWishesAsSeenBy } from "./viewer";

describe("viewer reads", () => {
  let ctx: TestDb;
  let db: Db;

  let ownerId: string;
  let groupMateId: string;
  let strangerId: string;
  let namedFriendId: string;
  let guestId: string;

  let publicWishId: string;
  let groupWishId: string;
  let personWishId: string;

  const titles = async (viewer: Parameters<typeof getVisibleWishes>[2]) =>
    (await getVisibleWishes(db, ownerId, viewer)).map((w) => w.title).sort();

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;

    ownerId = await createUser(db);
    groupMateId = await createUser(db);
    strangerId = await createUser(db);
    namedFriendId = await createUser(db);
    guestId = await createGuest(db, "guest-token-1");

    const groupId = await createGroup(db, ownerId, [ownerId, groupMateId]);
    // A group the owner is not part of must not unlock anything.
    const foreignGroupId = await createGroup(db, strangerId, [
      strangerId,
      namedFriendId,
    ]);

    publicWishId = await createWish(db, { ownerId, title: "Public" });
    groupWishId = await createWish(db, {
      ownerId,
      title: "Group only",
      visibility: "restricted",
    });
    personWishId = await createWish(db, {
      ownerId,
      title: "Person only",
      visibility: "restricted",
    });
    const foreignWishId = await createWish(db, {
      ownerId,
      title: "Foreign group only",
      visibility: "restricted",
    });
    await createWish(db, {
      ownerId,
      title: "Already gifted",
      status: "gifted",
      giftedAt: new Date(),
    });

    await db.insert(wishVisibility).values([
      { wishId: groupWishId, subjectType: "group", subjectId: groupId },
      { wishId: personWishId, subjectType: "user", subjectId: namedFriendId },
      {
        wishId: foreignWishId,
        subjectType: "group",
        subjectId: foreignGroupId,
      },
    ]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("shows everyone-wishes to anonymous visitors and guests", async () => {
    expect(await titles({ anonymous: true })).toEqual(["Public"]);
    expect(await titles({ guestId })).toEqual(["Public"]);
  });

  it("shows a group-restricted wish only to a shared-group member", async () => {
    expect(await titles({ userId: groupMateId })).toEqual([
      "Group only",
      "Public",
    ]);
    expect(await titles({ userId: strangerId })).toEqual(["Public"]);
  });

  it("shows a person-restricted wish only to that person", async () => {
    expect(await titles({ userId: namedFriendId })).toEqual([
      "Person only",
      "Public",
    ]);
  });

  it("ignores groups the owner is not a member of", async () => {
    for (const viewer of [
      { userId: namedFriendId },
      { userId: strangerId },
    ] as const) {
      const visible = await getVisibleWishes(db, ownerId, viewer);
      expect(visible.map((w) => w.title)).not.toContain("Foreign group only");
    }
  });

  it("hides gifted wishes and never exposes owner-only fields", async () => {
    const visible = await getVisibleWishes(db, ownerId, { anonymous: true });
    expect(visible.map((w) => w.title)).not.toContain("Already gifted");

    const [wish] = visible;
    expect(Object.keys(wish).sort()).toEqual([
      "category",
      "createdAt",
      "currency",
      "description",
      "id",
      "imageKey",
      "imageStatus",
      "isDream",
      "notes",
      "ownerId",
      "priceMax",
      "priceMin",
      "priceType",
      "priority",
      "reservationStatus",
      "title",
      "type",
      "url",
    ]);
  });

  it("reports reservationStatus per viewer identity", async () => {
    expect(
      await reserveWish(db, publicWishId, { userId: strangerId }),
    ).toMatchObject({ ok: true });
    expect(
      await reserveWish(db, groupWishId, { guestId: "not-a-uuid" }),
    ).toMatchObject({ ok: false, reason: "not_found" });

    const statusFor = async (
      viewer: Parameters<typeof getVisibleWishes>[2],
      wishId: string,
    ) =>
      (await getVisibleWishes(db, ownerId, viewer)).find((w) => w.id === wishId)
        ?.reservationStatus;

    expect(await statusFor({ userId: strangerId }, publicWishId)).toBe(
      "reserved_by_you",
    );
    expect(await statusFor({ userId: groupMateId }, publicWishId)).toBe(
      "reserved",
    );
    expect(await statusFor({ anonymous: true }, publicWishId)).toBe("reserved");
    expect(await statusFor({ guestId }, publicWishId)).toBe("reserved");
    expect(await statusFor({ userId: groupMateId }, groupWishId)).toBe("free");
  });

  it("reports reserved_by_you for a guest reserver", async () => {
    const otherOwner = await createUser(db);
    const wishId = await createWish(db, {
      ownerId: otherOwner,
      title: "Guest-reserved",
    });
    expect(await reserveWish(db, wishId, { guestId })).toMatchObject({
      ok: true,
    });

    const asGuest = await getVisibleWishes(db, otherOwner, { guestId });
    expect(asGuest[0].reservationStatus).toBe("reserved_by_you");

    const asOtherGuest = await getVisibleWishes(db, otherOwner, {
      guestId: await createGuest(db, "guest-token-2"),
    });
    expect(asOtherGuest[0].reservationStatus).toBe("reserved");
  });

  it("keeps the person-restricted wish invisible to guests", async () => {
    const visible = await getVisibleWishes(db, ownerId, { guestId });
    expect(visible.map((w) => w.id)).not.toContain(personWishId);
  });

  it("shows the owner their own list as free, however it is reached", async () => {
    // publicWishId is held by strangerId from the test above.
    const asSelf = await getVisibleWishes(db, ownerId, { userId: ownerId });
    const own = asSelf.find((w) => w.id === publicWishId);
    expect(own?.reservationStatus).toBe("free");
    expect(asSelf.every((w) => w.reservationStatus === "free")).toBe(true);

    // The friend still sees the truth — the owner is blind, not the list.
    const asFriend = await getVisibleWishes(db, ownerId, {
      userId: groupMateId,
    });
    expect(asFriend.find((w) => w.id === publicWishId)?.reservationStatus).toBe(
      "reserved",
    );
  });

  it("keeps the view-as preview free of reservation data", async () => {
    for (const simulated of [
      { anonymous: true },
      { guestId },
      { userId: groupMateId },
      { userId: strangerId },
    ] as const) {
      const preview = await getWishesAsSeenBy(db, ownerId, simulated);
      expect(preview.every((w) => w.reservationStatus === "free")).toBe(true);
    }
  });

  it("applies the same visibility rules in the preview", async () => {
    const asStranger = await getWishesAsSeenBy(db, ownerId, {
      userId: strangerId,
    });
    expect(asStranger.map((w) => w.title)).toEqual(["Public"]);

    const asGroupMate = await getWishesAsSeenBy(db, ownerId, {
      userId: groupMateId,
    });
    expect(asGroupMate.map((w) => w.title).sort()).toEqual([
      "Group only",
      "Public",
    ]);

    const asGuest = await getWishesAsSeenBy(db, ownerId, { guestId });
    expect(asGuest.map((w) => w.title)).toEqual(["Public"]);
  });

  describe("getVisibleWish (single share target)", () => {
    it("returns a restricted wish only to an authorized viewer", async () => {
      // Person-restricted to namedFriendId — invisible to everyone else.
      for (const viewer of [
        { anonymous: true },
        { guestId },
        { userId: strangerId },
      ] as const) {
        expect(await getVisibleWish(db, personWishId, viewer)).toBeNull();
      }
      const seen = await getVisibleWish(db, personWishId, {
        userId: namedFriendId,
      });
      expect(seen?.id).toBe(personWishId);
    });

    it("lets the owner open their own restricted wish (own /w share link)", async () => {
      // personWishId is restricted to namedFriendId, but the owner must still
      // be able to open its share link — and never see a reservation.
      const own = await getVisibleWish(db, personWishId, { userId: ownerId });
      expect(own?.id).toBe(personWishId);
      expect(own?.reservationStatus).toBe("free");
    });

    it("treats a missing or malformed id as not found", async () => {
      expect(
        await getVisibleWish(db, "not-a-uuid", { anonymous: true }),
      ).toBeNull();
      expect(
        await getVisibleWish(db, "00000000-0000-0000-0000-000000000000", {
          anonymous: true,
        }),
      ).toBeNull();
    });

    it("reports the reservation status for a non-owner viewer", async () => {
      // publicWishId was reserved by strangerId earlier in this suite.
      expect(
        (await getVisibleWish(db, publicWishId, { userId: strangerId }))
          ?.reservationStatus,
      ).toBe("reserved_by_you");
      expect(
        (await getVisibleWish(db, publicWishId, { anonymous: true }))
          ?.reservationStatus,
      ).toBe("reserved");
    });

    it("never exposes a reservation to the owner of the wish", async () => {
      const own = await getVisibleWish(db, publicWishId, { userId: ownerId });
      expect(own?.id).toBe(publicWishId);
      expect(own?.reservationStatus).toBe("free");
      expect(own).not.toHaveProperty("heldByUserId");
    });
  });
});
