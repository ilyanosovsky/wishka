// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `createWish` comes from `mutations.ts`, which reaches `lib/storage/uploadthing`
// — marked server-only, and that throws outside React's server condition.
vi.mock("server-only", () => ({}));

import type { Db } from "../index";
import { profiles, wishVisibility, wishes } from "../schema";
import {
  createGroup,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import type { WishInput } from "./mutations";
import type { WishAudience } from "./visibility";
import {
  createWishWithAudience,
  getAudienceCandidates,
  getWishAudience,
  isWishVisibleTo,
  setWishAudience,
} from "./visibility";
import { getVisibleWishes } from "./viewer";

const baseInput: WishInput = {
  type: "product",
  title: "Something",
  priceType: "none",
  priority: "want",
  isDream: false,
};

const everyone: WishAudience = {
  mode: "everyone",
  groupIds: [],
  userIds: [],
};

describe("wish audience", () => {
  let ctx: TestDb;
  let db: Db;

  let ownerId: string;
  let mateAId: string;
  let mateBId: string;
  let partnerId: string;
  let strangerId: string;

  let groupAId: string;
  let groupBId: string;
  let foreignGroupId: string;

  const subjects = async (wishId: string) =>
    (
      await db
        .select({
          subjectType: wishVisibility.subjectType,
          subjectId: wishVisibility.subjectId,
        })
        .from(wishVisibility)
        .where(eq(wishVisibility.wishId, wishId))
    ).sort((a, b) => a.subjectId.localeCompare(b.subjectId));

  const seenBy = async (viewer: Parameters<typeof getVisibleWishes>[2]) =>
    (await getVisibleWishes(db, ownerId, viewer)).map((w) => w.title).sort();

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;

    ownerId = await createUser(db, { name: "Owner" });
    mateAId = await createUser(db, { name: "Anna" });
    mateBId = await createUser(db, { name: "Boris" });
    // The partner shares no group with the owner — §6.3 still lists them.
    partnerId = await createUser(db, { name: "Zoe" });
    strangerId = await createUser(db, { name: "Stranger" });

    groupAId = await createGroup(db, ownerId, [ownerId, mateAId]);
    groupBId = await createGroup(db, ownerId, [ownerId, mateBId]);
    foreignGroupId = await createGroup(db, strangerId, [strangerId, mateAId]);

    await db
      .insert(profiles)
      .values({ userId: ownerId, nickname: "owner", partnerId });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("getAudienceCandidates", () => {
    it("lists the owner's groups and the people they can reach", async () => {
      const candidates = await getAudienceCandidates(db, ownerId);

      expect(candidates.groups.map((g) => g.id).sort()).toEqual(
        [groupAId, groupBId].sort(),
      );
      expect(candidates.groups.map((g) => g.id)).not.toContain(foreignGroupId);

      // The partner is pinned first even though "Zoe" sorts last by name.
      expect(candidates.people.map((p) => p.name)).toEqual([
        "Zoe",
        "Anna",
        "Boris",
      ]);
      expect(candidates.people[0]).toMatchObject({
        userId: partnerId,
        isPartner: true,
      });
      expect(candidates.people.every((p) => p.userId !== ownerId)).toBe(true);
      expect(candidates.people.map((p) => p.userId)).not.toContain(strangerId);
    });

    it("dedupes someone who shares two groups with the owner", async () => {
      const twoGroupsId = await createUser(db, { name: "Twice" });
      await createGroup(db, ownerId, [ownerId, twoGroupsId]);
      await createGroup(db, ownerId, [ownerId, twoGroupsId]);

      const people = (await getAudienceCandidates(db, ownerId)).people;
      expect(people.filter((p) => p.userId === twoGroupsId)).toHaveLength(1);
    });

    it("is empty for a user with no groups and no partner", async () => {
      const loner = await createUser(db, { name: "Loner" });
      expect(await getAudienceCandidates(db, loner)).toEqual({
        groups: [],
        people: [],
      });
    });
  });

  describe("setWishAudience", () => {
    it("refuses a group the owner is not a member of", async () => {
      const wishId = await createWish(db, { ownerId, title: "Foreign group" });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: [foreignGroupId],
          userIds: [],
        }),
      ).toEqual({ ok: false, error: "invalid_subject" });

      // Refused means untouched: no rows, and the wish is still public.
      expect(await subjects(wishId)).toEqual([]);
      expect((await getWishAudience(db, ownerId, wishId))?.mode).toBe(
        "everyone",
      );
    });

    it("refuses a person who shares no group with the owner", async () => {
      const wishId = await createWish(db, { ownerId, title: "Stranger" });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: [],
          userIds: [strangerId],
        }),
      ).toEqual({ ok: false, error: "invalid_subject" });
    });

    it("accepts the partner even with no group in common", async () => {
      const wishId = await createWish(db, {
        ownerId,
        title: "For the partner",
      });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: [],
          userIds: [partnerId],
        }),
      ).toEqual({ ok: true });
      expect(await subjects(wishId)).toEqual([
        { subjectType: "user", subjectId: partnerId },
      ]);
    });

    it("refuses the owner as a subject — that is an empty audience wearing a name", async () => {
      const wishId = await createWish(db, { ownerId, title: "Only me" });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: [],
          userIds: [ownerId],
        }),
      ).toEqual({ ok: false, error: "invalid_subject" });
    });

    it("refuses a restricted audience with nothing in it", async () => {
      const wishId = await createWish(db, { ownerId, title: "Nobody" });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: [],
          userIds: [],
        }),
      ).toEqual({ ok: false, error: "empty_audience" });
    });

    it("refuses a malformed subject list and a malformed mode", async () => {
      const wishId = await createWish(db, { ownerId, title: "Malformed" });
      // Hand-crafted server-action payloads are not typed; the cast is the
      // whole point of the test.
      const malformed = {
        mode: "restricted",
        groupIds: [42],
        userIds: [],
      } as unknown as WishAudience;
      expect(await setWishAudience(db, ownerId, wishId, malformed)).toEqual({
        ok: false,
        error: "invalid_subject",
      });

      const badMode = {
        ...everyone,
        mode: "nobody",
      } as unknown as WishAudience;
      expect(await setWishAudience(db, ownerId, wishId, badMode)).toEqual({
        ok: false,
        error: "invalid_subject",
      });
    });

    it("refuses an audience that is not an object at all", async () => {
      const wishId = await createWish(db, { ownerId, title: "No audience" });
      // A hand-crafted payload can carry anything; none of it may be
      // dereferenced into a TypeError instead of a validation result.
      for (const malformed of [null, undefined, "everyone", 42]) {
        expect(
          await setWishAudience(
            db,
            ownerId,
            wishId,
            malformed as unknown as WishAudience,
          ),
        ).toEqual({ ok: false, error: "invalid_subject" });
      }
      expect(await subjects(wishId)).toEqual([]);
      expect((await getWishAudience(db, ownerId, wishId))?.mode).toBe(
        "everyone",
      );
    });

    it("refuses a group id that is not a uuid", async () => {
      const wishId = await createWish(db, { ownerId, title: "Not a uuid" });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: ["not-a-uuid"],
          userIds: [],
        }),
      ).toEqual({ ok: false, error: "invalid_subject" });
    });

    it("treats another owner's wish and a malformed id the same way", async () => {
      const wishId = await createWish(db, {
        ownerId: strangerId,
        title: "Not mine",
      });
      expect(await setWishAudience(db, ownerId, wishId, everyone)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(
        await setWishAudience(db, ownerId, "not-a-uuid", everyone),
      ).toEqual({ ok: false, error: "not_found" });
    });

    it("replaces the previous audience wholesale, and everyone clears it", async () => {
      const wishId = await createWish(db, { ownerId, title: "Rewritten" });

      await setWishAudience(db, ownerId, wishId, {
        mode: "restricted",
        groupIds: [groupAId, groupBId],
        userIds: [mateAId],
      });
      expect(await subjects(wishId)).toHaveLength(3);

      await setWishAudience(db, ownerId, wishId, {
        mode: "restricted",
        groupIds: [groupBId],
        userIds: [],
      });
      expect(await subjects(wishId)).toEqual([
        { subjectType: "group", subjectId: groupBId },
      ]);

      expect(await setWishAudience(db, ownerId, wishId, everyone)).toEqual({
        ok: true,
      });
      expect(await subjects(wishId)).toEqual([]);
      const [row] = await db
        .select({ visibility: wishes.visibility })
        .from(wishes)
        .where(eq(wishes.id, wishId));
      expect(row.visibility).toBe("everyone");
    });

    it("stores a repeated subject once", async () => {
      const wishId = await createWish(db, { ownerId, title: "Duplicated" });
      expect(
        await setWishAudience(db, ownerId, wishId, {
          mode: "restricted",
          groupIds: [groupAId, groupAId],
          userIds: [mateAId, mateAId],
        }),
      ).toEqual({ ok: true });
      expect(await subjects(wishId)).toHaveLength(2);
    });
  });

  describe("getWishAudience", () => {
    it("reads back what was written", async () => {
      const wishId = await createWish(db, { ownerId, title: "Readback" });
      await setWishAudience(db, ownerId, wishId, {
        mode: "restricted",
        groupIds: [groupAId],
        userIds: [mateBId],
      });

      expect(await getWishAudience(db, ownerId, wishId)).toEqual({
        mode: "restricted",
        groupIds: [groupAId],
        userIds: [mateBId],
      });
    });

    it("is null for someone else's wish and for a malformed id", async () => {
      const wishId = await createWish(db, { ownerId, title: "Mine" });
      expect(await getWishAudience(db, strangerId, wishId)).toBeNull();
      expect(await getWishAudience(db, ownerId, "not-a-uuid")).toBeNull();
    });
  });

  /**
   * INVARIANT #2 — the rule is enforced in the data-access layer, so the proof
   * is the read path, not the rows: what `getVisibleWishes` hands each viewer.
   */
  describe("end to end through getVisibleWishes", () => {
    it("follows the audience from a group to a person and back to everyone", async () => {
      const wishId = await createWish(db, { ownerId, title: "Travelling" });
      const sees = async (viewer: Parameters<typeof getVisibleWishes>[2]) =>
        (await seenBy(viewer)).includes("Travelling");

      // Everyone, to start with.
      expect(await sees({ userId: mateAId })).toBe(true);
      expect(await sees({ userId: strangerId })).toBe(true);
      expect(await sees({ anonymous: true })).toBe(true);

      await setWishAudience(db, ownerId, wishId, {
        mode: "restricted",
        groupIds: [groupAId],
        userIds: [],
      });
      expect(await sees({ userId: mateAId })).toBe(true);
      expect(await sees({ userId: mateBId })).toBe(false);
      expect(await sees({ userId: strangerId })).toBe(false);
      expect(await sees({ anonymous: true })).toBe(false);

      await setWishAudience(db, ownerId, wishId, {
        mode: "restricted",
        groupIds: [],
        userIds: [mateBId],
      });
      expect(await sees({ userId: mateBId })).toBe(true);
      expect(await sees({ userId: mateAId })).toBe(false);

      await setWishAudience(db, ownerId, wishId, everyone);
      expect(await sees({ userId: mateAId })).toBe(true);
      expect(await sees({ userId: strangerId })).toBe(true);
      expect(await sees({ anonymous: true })).toBe(true);
    });
  });

  describe("createWishWithAudience", () => {
    it("creates the wish already restricted", async () => {
      const created = await createWishWithAudience(
        db,
        ownerId,
        { ...baseInput, title: "Born restricted" },
        { mode: "restricted", groupIds: [groupAId], userIds: [] },
      );
      if (!created.ok) throw new Error("expected the wish to be created");

      expect(created.wish.visibility).toBe("restricted");
      expect(await subjects(created.wish.id)).toEqual([
        { subjectType: "group", subjectId: groupAId },
      ]);
      expect(await seenBy({ userId: mateAId })).toContain("Born restricted");
      expect(await seenBy({ userId: strangerId })).not.toContain(
        "Born restricted",
      );
    });

    it("takes the wish down with a refused audience", async () => {
      const result = await createWishWithAudience(
        db,
        ownerId,
        { ...baseInput, title: "Never born" },
        { mode: "restricted", groupIds: [foreignGroupId], userIds: [] },
      );
      expect(result).toEqual({ ok: false, error: "invalid_subject" });

      const rows = await db
        .select({ id: wishes.id })
        .from(wishes)
        .where(eq(wishes.title, "Never born"));
      expect(rows).toEqual([]);
    });

    it("reports a wish validation error without touching the audience", async () => {
      const result = await createWishWithAudience(
        db,
        ownerId,
        { ...baseInput, title: "   " },
        { mode: "restricted", groupIds: [groupAId], userIds: [] },
      );
      expect(result).toEqual({ ok: false, error: "title" });
    });
  });

  describe("isWishVisibleTo", () => {
    it("answers for each identity the same way the list does", async () => {
      const wishId = await createWish(db, { ownerId, title: "Probe" });
      expect(await isWishVisibleTo(db, wishId, { anonymous: true })).toBe(true);

      await setWishAudience(db, ownerId, wishId, {
        mode: "restricted",
        groupIds: [groupAId],
        userIds: [],
      });
      expect(await isWishVisibleTo(db, wishId, { userId: mateAId })).toBe(true);
      expect(await isWishVisibleTo(db, wishId, { userId: mateBId })).toBe(
        false,
      );
      expect(await isWishVisibleTo(db, wishId, { anonymous: true })).toBe(
        false,
      );
      expect(await isWishVisibleTo(db, "not-a-uuid", { anonymous: true })).toBe(
        false,
      );
    });
  });
});
