// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { groupInvites } from "../schema";
import {
  addGroupMember,
  createGroupInvite,
  createTestDb,
  createUser,
  type TestDb,
} from "../test-support";
import {
  acceptInvite,
  getOrCreateActiveInvite,
  INVITE_TTL_DAYS,
  lookupInvite,
  revokeGroupInvites,
} from "./group-invites";
import {
  createGroup,
  getGroupDetail,
  isGroupMember,
  type GroupSummary,
} from "./groups";

const MISSING_ID = "00000000-0000-0000-0000-000000000000";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("group invites", () => {
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
    input: { name?: string; emoji?: string } = {},
  ): Promise<GroupSummary> => {
    const result = await createGroup(db, userId, {
      name: input.name ?? "Family",
      emoji: input.emoji ?? null,
    });
    if (!result.ok) throw new Error(`createGroup failed: ${result.error}`);
    return result.group;
  };

  const tokenFor = async (groupId: string, userId: string) => {
    const invite = await getOrCreateActiveInvite(db, groupId, userId);
    if (!invite) throw new Error("expected an invite");
    return invite.token;
  };

  describe("getOrCreateActiveInvite", () => {
    it("reuses the live link so an already-sent one keeps working", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });

      const first = await tokenFor(group.id, adminId);
      // Any member may share, and they all get the same link.
      expect(await tokenFor(group.id, memberId)).toBe(first);

      const [row] = await db
        .select({ expiresAt: groupInvites.expiresAt })
        .from(groupInvites)
        .where(eq(groupInvites.id, first));
      const ttlDays = Math.round(
        (row.expiresAt.getTime() - Date.now()) / DAY_MS,
      );
      expect(ttlDays).toBe(INVITE_TTL_DAYS);
    });

    it("mints a fresh link past an expired or revoked one", async () => {
      const adminId = await createUser(db);
      const group = await newGroup(adminId);
      const expired = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        expiresAt: new Date(Date.now() - DAY_MS),
      });
      const revoked = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        revokedAt: new Date(),
      });

      const token = await tokenFor(group.id, adminId);
      expect(token).not.toBe(expired);
      expect(token).not.toBe(revoked);
      // A dead link stays dead — reviving one would undo the revocation.
      expect(await lookupInvite(db, revoked)).toEqual({ state: "revoked" });
    });

    it("is null for a non-member, a missing group and a malformed id", async () => {
      const adminId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);

      expect(
        await getOrCreateActiveInvite(db, group.id, outsiderId),
      ).toBeNull();
      expect(await getOrCreateActiveInvite(db, MISSING_ID, adminId)).toBeNull();
      expect(
        await getOrCreateActiveInvite(db, "not-a-uuid", adminId),
      ).toBeNull();
    });
  });

  describe("lookupInvite", () => {
    it("resolves a live token to its group", async () => {
      const adminId = await createUser(db);
      const group = await newGroup(adminId, { name: "Семья", emoji: "🎄" });
      const token = await tokenFor(group.id, adminId);

      expect(await lookupInvite(db, token)).toEqual({
        state: "valid",
        token,
        groupId: group.id,
        groupName: "Семья",
        groupEmoji: "🎄",
      });
    });

    it("classifies expired, revoked and unknown tokens", async () => {
      const adminId = await createUser(db);
      const group = await newGroup(adminId);

      const expired = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        expiresAt: new Date(Date.now() - 1000),
      });
      const revoked = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        revokedAt: new Date(),
      });
      // Revocation outranks expiry: the holder is told the link was withdrawn.
      const both = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: new Date(),
      });

      expect(await lookupInvite(db, expired)).toEqual({ state: "expired" });
      expect(await lookupInvite(db, revoked)).toEqual({ state: "revoked" });
      expect(await lookupInvite(db, both)).toEqual({ state: "revoked" });
      expect(await lookupInvite(db, MISSING_ID)).toEqual({
        state: "not_found",
      });
      expect(await lookupInvite(db, "not-a-uuid")).toEqual({
        state: "not_found",
      });
    });
  });

  describe("acceptInvite", () => {
    it("joins as a member and is idempotent afterwards", async () => {
      const adminId = await createUser(db);
      const joinerId = await createUser(db);
      const group = await newGroup(adminId, { name: "Друзья" });
      const token = await tokenFor(group.id, adminId);

      expect(await acceptInvite(db, token, joinerId)).toEqual({
        ok: true,
        groupId: group.id,
        groupName: "Друзья",
        alreadyMember: false,
      });
      expect(await isGroupMember(db, group.id, joinerId)).toBe(true);

      expect(await acceptInvite(db, token, joinerId)).toEqual({
        ok: true,
        groupId: group.id,
        groupName: "Друзья",
        alreadyMember: true,
      });

      // The inviter opening their own link is "already in", not a duplicate row.
      expect(await acceptInvite(db, token, adminId)).toMatchObject({
        ok: true,
        alreadyMember: true,
      });
    });

    it("joins as a plain member, never an admin", async () => {
      const adminId = await createUser(db);
      const joinerId = await createUser(db);
      const group = await newGroup(adminId);
      await acceptInvite(db, await tokenFor(group.id, adminId), joinerId);

      expect(await isGroupMember(db, group.id, joinerId)).toBe(true);
      const detail = await getGroupDetail(db, group.id, joinerId);
      expect(detail?.role).toBe("member");
      expect(detail?.members.map((member) => member.role)).toEqual([
        "admin",
        "member",
      ]);
    });

    it("refuses expired, revoked and unknown tokens without writing", async () => {
      const adminId = await createUser(db);
      const joinerId = await createUser(db);
      const group = await newGroup(adminId);
      const expired = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        expiresAt: new Date(Date.now() - 1000),
      });
      const revoked = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        revokedAt: new Date(),
      });

      expect(await acceptInvite(db, expired, joinerId)).toEqual({
        ok: false,
        state: "expired",
      });
      expect(await acceptInvite(db, revoked, joinerId)).toEqual({
        ok: false,
        state: "revoked",
      });
      expect(await acceptInvite(db, MISSING_ID, joinerId)).toEqual({
        ok: false,
        state: "not_found",
      });
      expect(await acceptInvite(db, "not-a-uuid", joinerId)).toEqual({
        ok: false,
        state: "not_found",
      });
      expect(await isGroupMember(db, group.id, joinerId)).toBe(false);
    });
  });

  describe("revokeGroupInvites", () => {
    it("kills every live link at once and keeps earlier revocations", async () => {
      const adminId = await createUser(db);
      const group = await newGroup(adminId);
      const earlier = new Date(Date.now() - 5 * DAY_MS);
      const alreadyRevoked = await createGroupInvite(db, {
        groupId: group.id,
        createdBy: adminId,
        revokedAt: earlier,
      });
      const live = await tokenFor(group.id, adminId);

      expect(await revokeGroupInvites(db, group.id, adminId)).toEqual({
        ok: true,
      });
      expect(await lookupInvite(db, live)).toEqual({ state: "revoked" });

      const [untouched] = await db
        .select({ revokedAt: groupInvites.revokedAt })
        .from(groupInvites)
        .where(eq(groupInvites.id, alreadyRevoked));
      expect(untouched.revokedAt?.getTime()).toBe(earlier.getTime());

      // Sharing again starts over rather than resurrecting the dead link.
      expect(await tokenFor(group.id, adminId)).not.toBe(live);
    });

    it("is admin-only", async () => {
      const adminId = await createUser(db);
      const memberId = await createUser(db);
      const outsiderId = await createUser(db);
      const group = await newGroup(adminId);
      await addGroupMember(db, { groupId: group.id, userId: memberId });
      const token = await tokenFor(group.id, adminId);

      expect(await revokeGroupInvites(db, group.id, memberId)).toEqual({
        ok: false,
      });
      expect(await revokeGroupInvites(db, group.id, outsiderId)).toEqual({
        ok: false,
      });
      expect(await revokeGroupInvites(db, "not-a-uuid", adminId)).toEqual({
        ok: false,
      });
      expect(await lookupInvite(db, token)).toMatchObject({ state: "valid" });
    });
  });
});
