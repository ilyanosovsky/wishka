// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { groupMembers, groups, profiles, wishVisibility } from "../schema";
import {
  addGroupMember,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { acceptInvite, getOrCreateActiveInvite } from "./group-invites";
import {
  createGroup,
  deleteGroup,
  getGroupDetail,
  getMyGroups,
  GROUP_COLORS,
  isGroupMember,
  leaveGroup,
  removeMember,
  updateGroup,
  type GroupSummary,
} from "./groups";
import { getVisibleWishes } from "./viewer";

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

describe("groups", () => {
  let ctx: TestDb;
  let db: Db;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const newGroup = async (
    userId: string,
    name = "Family",
  ): Promise<GroupSummary> => {
    const result = await createGroup(db, userId, { name });
    if (!result.ok) throw new Error(`createGroup failed: ${result.error}`);
    return result.group;
  };

  const roleOf = async (groupId: string, userId: string) => {
    const [row] = await db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
      );
    return row?.role ?? null;
  };

  describe("createGroup", () => {
    it("makes the creator an admin and trims the name", async () => {
      const userId = await createUser(db);
      const result = await createGroup(db, userId, {
        name: "  Семья  ",
        emoji: "🎁",
        color: "accent",
      });

      expect(result).toMatchObject({
        ok: true,
        group: {
          name: "Семья",
          emoji: "🎁",
          color: "accent",
          role: "admin",
          memberCount: 1,
        },
      });
      if (!result.ok) return;
      expect(await roleOf(result.group.id, userId)).toBe("admin");
    });

    it("stores an empty emoji and an absent color as null", async () => {
      const userId = await createUser(db);
      const result = await createGroup(db, userId, {
        name: "Plain",
        emoji: " ",
      });
      expect(result).toMatchObject({
        ok: true,
        group: { emoji: null, color: null },
      });
    });

    it("rejects a blank or over-long name", async () => {
      const userId = await createUser(db);
      expect(await createGroup(db, userId, { name: "   " })).toEqual({
        ok: false,
        error: "name",
      });
      expect(await createGroup(db, userId, { name: "x".repeat(61) })).toEqual({
        ok: false,
        error: "name",
      });
    });

    it("rejects an over-long emoji and a colour outside the allow-list", async () => {
      const userId = await createUser(db);
      expect(
        await createGroup(db, userId, {
          name: "Ok",
          emoji: "🎁🎁🎁🎁🎁🎁🎁🎁🎁",
        }),
      ).toEqual({ ok: false, error: "emoji" });
      expect(
        await createGroup(db, userId, { name: "Ok", color: "#ff0000" }),
      ).toEqual({ ok: false, error: "color" });
      // Every advertised swatch key must be accepted.
      for (const color of GROUP_COLORS) {
        expect(
          await createGroup(db, userId, { name: "Ok", color }),
        ).toMatchObject({ ok: true });
      }
    });
  });

  describe("getMyGroups", () => {
    it("returns only the caller's groups, newest first, with member counts", async () => {
      const userId = await createUser(db);
      const mateId = await createUser(db);
      const strangerId = await createUser(db);

      const older = await newGroup(userId, "Older");
      const newer = await newGroup(userId, "Newer");
      await addGroupMember(db, { groupId: newer.id, userId: mateId });
      await newGroup(strangerId, "Not mine");

      const mine = await getMyGroups(db, userId);
      expect(mine.map((g) => g.name)).toEqual(["Newer", "Older"]);
      expect(mine[0]).toMatchObject({ memberCount: 2, role: "admin" });
      expect(mine[1]).toMatchObject({ memberCount: 1, role: "admin" });

      expect(await getMyGroups(db, mateId)).toMatchObject([
        { id: newer.id, role: "member", memberCount: 2 },
      ]);
      expect(await getMyGroups(db, await createUser(db))).toEqual([]);
      expect(older.role).toBe("admin");
    });
  });

  describe("getGroupDetail", () => {
    it("is null for a non-member and for a missing group alike", async () => {
      const adminId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);

      expect(await getGroupDetail(db, group.id, outsiderId)).toBeNull();
      expect(await getGroupDetail(db, MISSING_ID, adminId)).toBeNull();
      expect(await getGroupDetail(db, "not-a-uuid", adminId)).toBeNull();
    });

    it("orders admins first, then by tenure, and carries the viewer's role", async () => {
      const adminId = await createUser(db);
      const earlyId = await createUser(db);
      const lateId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, {
        groupId: group.id,
        userId: lateId,
        joinedAt: new Date("2026-03-01T00:00:00Z"),
      });
      await addGroupMember(db, {
        groupId: group.id,
        userId: earlyId,
        joinedAt: new Date("2026-01-01T00:00:00Z"),
      });

      const detail = await getGroupDetail(db, group.id, earlyId);
      expect(detail?.role).toBe("member");
      expect(detail?.members.map((m) => m.userId)).toEqual([
        adminId,
        earlyId,
        lateId,
      ]);
      expect(detail?.members[0].role).toBe("admin");
    });

    it("reports hasVisibleWishes through the viewer's own visibility rules", async () => {
      const viewerId = await createUser(db);
      const publicOwnerId = await createUser(db);
      const secretiveOwnerId = await createUser(db);
      const emptyOwnerId = await createUser(db);
      const group = await newGroup(viewerId);
      for (const userId of [publicOwnerId, secretiveOwnerId, emptyOwnerId]) {
        await addGroupMember(db, { groupId: group.id, userId });
      }
      await db.insert(profiles).values({
        userId: publicOwnerId,
        nickname: `nick-${publicOwnerId}`,
      });

      await createWish(db, { ownerId: publicOwnerId, title: "Open to all" });
      // Restricted to nobody: the group is not named, so the viewer sees none.
      await createWish(db, {
        ownerId: secretiveOwnerId,
        title: "Hidden",
        visibility: "restricted",
      });
      await createWish(db, {
        ownerId: emptyOwnerId,
        title: "Gifted away",
        status: "gifted",
      });

      const detail = await getGroupDetail(db, group.id, viewerId);
      const byUser = new Map(detail?.members.map((m) => [m.userId, m]));
      expect(byUser.get(publicOwnerId)).toMatchObject({
        hasVisibleWishes: true,
        nickname: `nick-${publicOwnerId}`,
      });
      expect(byUser.get(secretiveOwnerId)).toMatchObject({
        hasVisibleWishes: false,
        nickname: null,
      });
      expect(byUser.get(emptyOwnerId)?.hasVisibleWishes).toBe(false);
      expect(byUser.get(viewerId)?.hasVisibleWishes).toBe(false);
    });
  });

  describe("updateGroup", () => {
    it("lets any member rename and restyle", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });

      const renamed = await updateGroup(db, group.id, memberId, {
        name: "  Друзья ",
        emoji: "🍰",
        color: "null",
      });
      expect(renamed).toMatchObject({
        ok: true,
        group: { name: "Друзья", emoji: "🍰", color: "null", role: "member" },
      });

      const cleared = await updateGroup(db, group.id, adminId, {
        emoji: null,
        color: null,
      });
      expect(cleared).toMatchObject({
        ok: true,
        group: { name: "Друзья", emoji: null, color: null, role: "admin" },
      });
    });

    it("refuses a non-member and a missing group the same way", async () => {
      const adminId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);

      expect(
        await updateGroup(db, group.id, outsiderId, { name: "Mine" }),
      ).toEqual({ ok: false, error: "forbidden" });
      expect(
        await updateGroup(db, MISSING_ID, adminId, { name: "Mine" }),
      ).toEqual({ ok: false, error: "forbidden" });
      expect(await updateGroup(db, "not-a-uuid", adminId, {})).toEqual({
        ok: false,
        error: "forbidden",
      });
    });

    it("validates the fields it is given and leaves the row untouched", async () => {
      const adminId = await createUser(db);
      const group = await newGroup(adminId, "Keep me");

      expect(await updateGroup(db, group.id, adminId, { name: "" })).toEqual({
        ok: false,
        error: "name",
      });
      expect(
        await updateGroup(db, group.id, adminId, { color: "chartreuse" }),
      ).toEqual({ ok: false, error: "color" });

      const detail = await getGroupDetail(db, group.id, adminId);
      expect(detail?.name).toBe("Keep me");
    });
  });

  describe("leaveGroup", () => {
    it("deletes the group when the last member walks out", async () => {
      const adminId = await createUser(db);
      const group = await newGroup(adminId);
      const wishId = await createWish(db, {
        ownerId: adminId,
        title: "Group only",
        visibility: "restricted",
      });
      await db
        .insert(wishVisibility)
        .values({ wishId, subjectType: "group", subjectId: group.id });

      expect(await leaveGroup(db, group.id, adminId)).toEqual({
        ok: true,
        groupDeleted: true,
      });
      expect(
        await db.select().from(groups).where(eq(groups.id, group.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(wishVisibility)
          .where(eq(wishVisibility.subjectId, group.id)),
      ).toHaveLength(0);
    });

    it("promotes the longest-tenured member and moves createdBy when the only admin leaves", async () => {
      const adminId = await createUser(db, { id: "admin-succession" });
      const earlyId = await createUser(db, { id: "early-succession" });
      const lateId = await createUser(db, { id: "late-succession" });
      const group = await newGroup(adminId);
      await addGroupMember(db, {
        groupId: group.id,
        userId: lateId,
        joinedAt: new Date("2026-03-01T00:00:00Z"),
      });
      await addGroupMember(db, {
        groupId: group.id,
        userId: earlyId,
        joinedAt: new Date("2026-01-01T00:00:00Z"),
      });

      expect(await leaveGroup(db, group.id, adminId)).toEqual({
        ok: true,
        groupDeleted: false,
      });
      expect(await roleOf(group.id, adminId)).toBeNull();
      expect(await roleOf(group.id, earlyId)).toBe("admin");
      expect(await roleOf(group.id, lateId)).toBe("member");

      // A stale created_by would take the group down with the leaver's account.
      const [row] = await db
        .select({ createdBy: groups.createdBy })
        .from(groups)
        .where(eq(groups.id, group.id));
      expect(row.createdBy).toBe(earlyId);
    });

    it("changes no roles when a plain member leaves", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const otherId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });
      await addGroupMember(db, { groupId: group.id, userId: otherId });

      expect(await leaveGroup(db, group.id, memberId)).toEqual({
        ok: true,
        groupDeleted: false,
      });
      expect(await roleOf(group.id, adminId)).toBe("admin");
      expect(await roleOf(group.id, otherId)).toBe("member");
      const [row] = await db
        .select({ createdBy: groups.createdBy })
        .from(groups)
        .where(eq(groups.id, group.id));
      expect(row.createdBy).toBe(adminId);
    });

    it("keeps a second admin in place instead of promoting anyone", async () => {
      const adminId = await createUser(db);
      const coAdminId = await createUser(db);
      const memberId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, {
        groupId: group.id,
        userId: coAdminId,
        role: "admin",
      });
      await addGroupMember(db, { groupId: group.id, userId: memberId });

      await leaveGroup(db, group.id, adminId);
      expect(await roleOf(group.id, coAdminId)).toBe("admin");
      expect(await roleOf(group.id, memberId)).toBe("member");
    });

    it("is not_found for a non-member, a missing group and a malformed id", async () => {
      const adminId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);

      const refused = { ok: false, reason: "not_found" };
      expect(await leaveGroup(db, group.id, outsiderId)).toEqual(refused);
      expect(await leaveGroup(db, MISSING_ID, adminId)).toEqual(refused);
      expect(await leaveGroup(db, "not-a-uuid", adminId)).toEqual(refused);
    });
  });

  describe("removeMember", () => {
    it("lets an admin remove another member", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });

      expect(await removeMember(db, group.id, adminId, memberId)).toEqual({
        ok: true,
      });
      expect(await isGroupMember(db, group.id, memberId)).toBe(false);
    });

    it("refuses a plain member, self-removal and a non-member target", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const otherId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });
      await addGroupMember(db, { groupId: group.id, userId: otherId });

      expect(await removeMember(db, group.id, memberId, otherId)).toEqual({
        ok: false,
      });
      expect(await removeMember(db, group.id, adminId, adminId)).toEqual({
        ok: false,
      });
      expect(await removeMember(db, group.id, adminId, outsiderId)).toEqual({
        ok: false,
      });
      expect(await removeMember(db, group.id, outsiderId, memberId)).toEqual({
        ok: false,
      });
      expect(await roleOf(group.id, adminId)).toBe("admin");
      expect(await isGroupMember(db, group.id, otherId)).toBe(true);
    });
  });

  describe("deleteGroup", () => {
    it("removes the group's dangling visibility rows and nothing else", async () => {
      const adminId = await createUser(db);
      const friendId = await createUser(db);
      const group = await newGroup(adminId);
      const otherGroup = await newGroup(adminId, "Other");
      const wishId = await createWish(db, {
        ownerId: adminId,
        title: "Restricted",
        visibility: "restricted",
      });
      await db.insert(wishVisibility).values([
        { wishId, subjectType: "group", subjectId: group.id },
        { wishId, subjectType: "group", subjectId: otherGroup.id },
        // Same id shape, different subject type — must survive.
        { wishId, subjectType: "user", subjectId: friendId },
      ]);

      expect(await deleteGroup(db, group.id, adminId)).toEqual({ ok: true });
      expect(
        await db.select().from(groups).where(eq(groups.id, group.id)),
      ).toHaveLength(0);

      const left = await db
        .select({
          subjectType: wishVisibility.subjectType,
          subjectId: wishVisibility.subjectId,
        })
        .from(wishVisibility)
        .where(eq(wishVisibility.wishId, wishId));
      expect(left).toEqual(
        expect.arrayContaining([
          { subjectType: "group", subjectId: otherGroup.id },
          { subjectType: "user", subjectId: friendId },
        ]),
      );
      expect(left).toHaveLength(2);
    });

    it("is refused for a plain member and a non-member", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });

      expect(await deleteGroup(db, group.id, memberId)).toEqual({ ok: false });
      expect(await deleteGroup(db, group.id, outsiderId)).toEqual({
        ok: false,
      });
      expect(await deleteGroup(db, MISSING_ID, adminId)).toEqual({ ok: false });
      expect(await deleteGroup(db, "not-a-uuid", adminId)).toEqual({
        ok: false,
      });
      expect(
        await db.select().from(groups).where(eq(groups.id, group.id)),
      ).toHaveLength(1);
    });
  });

  /**
   * Invariant #2 end to end: membership is the only thing standing between a
   * viewer and a group-restricted wish, and it must swing both ways.
   */
  describe("group membership as a visibility change", () => {
    it("follows the member in and out of the group", async () => {
      const ownerId = await createUser(db);
      const memberId = await createUser(db);
      const strangerId = await createUser(db);
      const group = await newGroup(ownerId, "Inner circle");

      const invite = await getOrCreateActiveInvite(db, group.id, ownerId);
      expect(invite).not.toBeNull();
      const token = invite?.token ?? "";
      expect(await acceptInvite(db, token, memberId)).toMatchObject({
        ok: true,
        alreadyMember: false,
      });

      await createWish(db, { ownerId, title: "Public" });
      const wishId = await createWish(db, {
        ownerId,
        title: "Group only",
        visibility: "restricted",
      });
      await db
        .insert(wishVisibility)
        .values({ wishId, subjectType: "group", subjectId: group.id });

      const titlesFor = async (userId: string) =>
        (await getVisibleWishes(db, ownerId, { userId }))
          .map((wish) => wish.title)
          .sort();

      expect(await titlesFor(memberId)).toEqual(["Group only", "Public"]);
      expect(await titlesFor(strangerId)).toEqual(["Public"]);

      expect(await leaveGroup(db, group.id, memberId)).toEqual({
        ok: true,
        groupDeleted: false,
      });
      expect(await titlesFor(memberId)).toEqual(["Public"]);

      // The link is still live, so re-joining restores exactly what was lost.
      expect(await acceptInvite(db, token, memberId)).toMatchObject({
        ok: true,
        alreadyMember: false,
      });
      expect(await titlesFor(memberId)).toEqual(["Group only", "Public"]);
    });

    it("revokes access when the member is removed by an admin", async () => {
      const ownerId = await createUser(db);
      const memberId = await createUser(db);
      const group = await newGroup(ownerId, "Short-lived");
      await addGroupMember(db, { groupId: group.id, userId: memberId });

      const wishId = await createWish(db, {
        ownerId,
        title: "Group only",
        visibility: "restricted",
      });
      await db
        .insert(wishVisibility)
        .values({ wishId, subjectType: "group", subjectId: group.id });

      expect(
        (await getVisibleWishes(db, ownerId, { userId: memberId })).map(
          (wish) => wish.title,
        ),
      ).toEqual(["Group only"]);

      await removeMember(db, group.id, ownerId, memberId);
      expect(
        await getVisibleWishes(db, ownerId, { userId: memberId }),
      ).toHaveLength(0);
    });
  });
});
