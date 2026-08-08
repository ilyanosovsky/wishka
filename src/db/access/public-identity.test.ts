// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { createTestDb, createUser, type TestDb } from "../test-support";
import { upsertProfile } from "./profiles";
import {
  getPublicIdentityByNickname,
  getPublicIdentityByUserId,
} from "./public-identity";

describe("public identity", () => {
  let ctx: TestDb;
  let db: Db;
  let userId: string;
  let namelessId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    userId = await createUser(db, {
      name: "Маша",
      image: "https://app123.ufs.sh/f/avatar-masha",
    });
    namelessId = await createUser(db, { name: "Петя" });
    await upsertProfile(db, { userId, nickname: "masha" });
    await upsertProfile(db, { userId: namelessId, nickname: "petya" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("never mentions the booking table in its source", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/db/access/public-identity.ts"),
      "utf8",
    );
    expect(source).not.toContain("reservations");
    expect(source).not.toContain("reservationStatus");
  });

  it("returns the display name and avatar for a nickname", async () => {
    expect(await getPublicIdentityByNickname(db, "masha")).toEqual({
      userId,
      nickname: "masha",
      name: "Маша",
      image: "https://app123.ufs.sh/f/avatar-masha",
    });
  });

  it("matches the nickname case-insensitively, like the list URL does", async () => {
    const identity = await getPublicIdentityByNickname(db, "MaSha");
    expect(identity?.name).toBe("Маша");
    // The stored casing comes back, not what the URL happened to carry.
    expect(identity?.nickname).toBe("masha");
  });

  it("returns null for an unknown nickname", async () => {
    expect(await getPublicIdentityByNickname(db, "nobody")).toBeNull();
  });

  it("returns the same identity keyed by user id", async () => {
    expect(await getPublicIdentityByUserId(db, userId)).toEqual({
      userId,
      nickname: "masha",
      name: "Маша",
      image: "https://app123.ufs.sh/f/avatar-masha",
    });
  });

  it("carries a null image when the user has no avatar", async () => {
    expect(await getPublicIdentityByUserId(db, namelessId)).toMatchObject({
      name: "Петя",
      image: null,
    });
  });

  it("returns null for a user with no profile (onboarding never finished)", async () => {
    const strangerId = await createUser(db);
    expect(await getPublicIdentityByUserId(db, strangerId)).toBeNull();
  });

  it("selects nothing beyond the four public identity columns", async () => {
    const identity = await getPublicIdentityByNickname(db, "masha");
    expect(Object.keys(identity ?? {}).sort()).toEqual([
      "image",
      "name",
      "nickname",
      "userId",
    ]);
  });
});
