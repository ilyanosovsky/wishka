// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "../index";
import {
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import { findActiveWishByUrl } from "./wish-lookup";

const URL_A = "https://shop.example/products/vase";
const URL_B = "https://shop.example/products/mug";

describe("findActiveWishByUrl", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let strangerId: string;
  let wishId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db);
    strangerId = await createUser(db);
    wishId = await createWish(db, {
      ownerId,
      title: "Ceramic vase",
      url: URL_A,
    });
    await createWish(db, {
      ownerId,
      title: "Old mug",
      url: URL_B,
      status: "gifted",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("finds the owner's active wish with that URL", async () => {
    expect(await findActiveWishByUrl(db, ownerId, URL_A)).toEqual({
      id: wishId,
      title: "Ceramic vase",
    });
  });

  it("ignores archived wishes — re-adding a gifted thing is legitimate", async () => {
    expect(await findActiveWishByUrl(db, ownerId, URL_B)).toBeNull();
  });

  it("never reports someone else's wish", async () => {
    expect(await findActiveWishByUrl(db, strangerId, URL_A)).toBeNull();
  });

  it("matches exactly, not by prefix", async () => {
    expect(
      await findActiveWishByUrl(db, ownerId, `${URL_A}?variant=2`),
    ).toBeNull();
  });

  it("returns null for an empty URL rather than matching a wish without one", async () => {
    await createWish(db, { ownerId, title: "Manual wish" });
    expect(await findActiveWishByUrl(db, ownerId, "")).toBeNull();
  });

  it("cannot leak reservation state — it reads one table", async () => {
    const source = await readFile(
      path.join(import.meta.dirname, "wish-lookup.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/reservation/i);
  });
});
