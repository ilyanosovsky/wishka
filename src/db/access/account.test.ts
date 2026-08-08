// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { groupMembers, groups, reservations, wishVisibility } from "../schema";
import {
  addGroupMember,
  createReservation,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { deleteAccount } from "./account";
import { createGroup } from "./groups";

describe("deleteAccount", () => {
  let ctx: TestDb;
  let db: Db;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("deletes the user row", async () => {
    const userId = await createUser(db);
    const result = await deleteAccount(db, userId);
    expect(result).toEqual({ ok: true });
  });

  it("is a no-op on an already-gone user", async () => {
    const userId = await createUser(db);
    await deleteAccount(db, userId);
    const result = await deleteAccount(db, userId);
    expect(result).toEqual({ ok: false });
  });

  it("hands a co-member's group to a new admin with created_by moved, instead of deleting it", async () => {
    const creator = await createUser(db);
    const survivor = await createUser(db);
    const groupResult = await createGroup(db, creator, { name: "Family" });
    if (!groupResult.ok) throw new Error("createGroup failed");
    const groupId = groupResult.group.id;
    await addGroupMember(db, { groupId, userId: survivor, role: "member" });

    await deleteAccount(db, creator);

    const [row] = await db
      .select({ createdBy: groups.createdBy })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    expect(row?.createdBy).toBe(survivor);

    const members = await db
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    expect(members).toEqual([{ userId: survivor, role: "admin" }]);
  });

  it("deletes a solo group along with its wish_visibility rows", async () => {
    const owner = await createUser(db);
    const groupResult = await createGroup(db, owner, { name: "Solo" });
    if (!groupResult.ok) throw new Error("createGroup failed");
    const groupId = groupResult.group.id;

    const otherOwner = await createUser(db);
    const wishId = await createWish(db, {
      ownerId: otherOwner,
      title: "Restricted wish",
      visibility: "restricted",
    });
    await db
      .insert(wishVisibility)
      .values({ wishId, subjectType: "group", subjectId: groupId });

    await deleteAccount(db, owner);

    const [group] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    expect(group).toBeUndefined();

    const rows = await db
      .select()
      .from(wishVisibility)
      .where(eq(wishVisibility.subjectId, groupId));
    expect(rows).toEqual([]);
  });

  it("removes bookings the deleted account held on someone else's list", async () => {
    const reserver = await createUser(db);
    const owner = await createUser(db);
    const wishId = await createWish(db, { ownerId: owner, title: "Gift" });
    const reservationId = await createReservation(db, {
      wishId,
      listOwnerId: owner,
      wishTitle: "Gift",
      reserverUserId: reserver,
      state: "active",
    });

    await deleteAccount(db, reserver);

    const [row] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it("removes bookings held on the deleted account's own wishes", async () => {
    const owner = await createUser(db);
    const reserver = await createUser(db);
    const wishId = await createWish(db, { ownerId: owner, title: "Gift" });
    const reservationId = await createReservation(db, {
      wishId,
      listOwnerId: owner,
      wishTitle: "Gift",
      reserverUserId: reserver,
      state: "active",
    });

    await deleteAccount(db, owner);

    const [row] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .limit(1);
    expect(row).toBeUndefined();
  });

  it("leaves an unrelated group untouched when the deleted account wasn't in it", async () => {
    const bystander = await createUser(db);
    const groupResult = await createGroup(db, bystander, { name: "Unrelated" });
    if (!groupResult.ok) throw new Error("createGroup failed");

    const loner = await createUser(db);
    await deleteAccount(db, loner);

    const [row] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.id, groupResult.group.id))
      .limit(1);
    expect(row?.id).toBe(groupResult.group.id);
  });
});
