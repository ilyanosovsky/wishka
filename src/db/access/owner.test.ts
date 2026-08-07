// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { reservations } from "../schema";
import {
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { getOwnerWish, getOwnerWishes } from "./owner";

const OWNER_WISH_KEYS = [
  "category",
  "createdAt",
  "currency",
  "description",
  "giftedAt",
  "giftedBy",
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
  "status",
  "title",
  "type",
  "updatedAt",
  "url",
  "visibility",
];

describe("owner reads", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let friendId: string;
  let wishId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db);
    friendId = await createUser(db);
    wishId = await createWish(db, {
      ownerId,
      title: "Espresso machine",
      priceType: "exact",
      priceMin: "199.00",
      currency: "EUR",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("returns exactly the owner DTO fields", async () => {
    const wishList = await getOwnerWishes(db, ownerId);
    expect(wishList).toHaveLength(1);
    expect(Object.keys(wishList[0]).sort()).toEqual(OWNER_WISH_KEYS);
  });

  it("is byte-identical before and after someone reserves the wish", async () => {
    const before = await getOwnerWishes(db, ownerId);

    await db.insert(reservations).values({
      wishId,
      reserverUserId: friendId,
      state: "active",
    });

    const after = await getOwnerWishes(db, ownerId);
    expect(after).toEqual(before);
    expect(Object.keys(after[0]).sort()).toEqual(OWNER_WISH_KEYS);

    const single = await getOwnerWish(db, ownerId, wishId);
    expect(single).toEqual(before[0]);
  });

  it("never mentions the booking table in its source", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/db/access/owner.ts"),
      "utf8",
    );
    expect(source).not.toContain("reservations");
  });

  it("scopes reads to the owner", async () => {
    expect(await getOwnerWishes(db, friendId)).toEqual([]);
    expect(await getOwnerWish(db, friendId, wishId)).toBeNull();
    expect(await getOwnerWish(db, ownerId, "not-a-uuid")).toBeNull();
  });

  it("separates the live list from the archive", async () => {
    const archivedOwner = await createUser(db);
    await createWish(db, { ownerId: archivedOwner, title: "Live" });
    await createWish(db, {
      ownerId: archivedOwner,
      title: "Gifted",
      status: "gifted",
      giftedAt: new Date(),
      giftedBy: "Mom",
    });

    const active = await getOwnerWishes(db, archivedOwner);
    expect(active.map((w) => w.title)).toEqual(["Live"]);

    const archived = await getOwnerWishes(db, archivedOwner, {
      status: "gifted",
    });
    expect(archived.map((w) => w.title)).toEqual(["Gifted"]);
    expect(archived[0].giftedBy).toBe("Mom");

    const all = await getOwnerWishes(db, archivedOwner, { status: "all" });
    expect(all).toHaveLength(2);
  });
});
