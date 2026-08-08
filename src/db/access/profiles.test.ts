// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { profiles } from "../schema";
import { createTestDb, createUser, type TestDb } from "../test-support";
import {
  getProfile,
  getProfileByNickname,
  isNicknameAvailable,
  isValidNickname,
  NicknameTakenError,
  upsertProfile,
} from "./profiles";

describe("profiles", () => {
  let ctx: TestDb;
  let db: Db;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    userId = await createUser(db);
    otherUserId = await createUser(db);
    await upsertProfile(db, { userId, nickname: "ilya" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("stores defaults on first write", async () => {
    const profile = await getProfile(db, userId);
    expect(profile).toMatchObject({
      userId,
      nickname: "ilya",
      baseCurrency: "USD",
      partnerId: null,
      sizes: {},
      tastes: [],
      noGift: [],
    });
  });

  it("updates an existing profile in place", async () => {
    await upsertProfile(db, {
      userId,
      nickname: "ilya",
      baseCurrency: "EUR",
      tastes: ["coffee", "books"],
    });

    const profile = await getProfile(db, userId);
    expect(profile).toMatchObject({
      baseCurrency: "EUR",
      tastes: ["coffee", "books"],
      sizes: {},
    });
    expect(await db.select().from(profiles)).toHaveLength(1);
  });

  it("returns null for a user without a profile", async () => {
    expect(await getProfile(db, otherUserId)).toBeNull();
  });

  it("rejects an invalid nickname on write", async () => {
    await expect(
      upsertProfile(db, { userId: otherUserId, nickname: "No" }),
    ).rejects.toThrow(/Invalid nickname/);
  });

  it("validates the nickname format", () => {
    for (const ok of ["abc", "ilya", "a-b-c", "x".repeat(30), "user-42"]) {
      expect(isValidNickname(ok)).toBe(true);
    }
    for (const bad of [
      "ab",
      "x".repeat(31),
      "Ilya",
      "ил_я",
      "with space",
      "under_score",
      "dot.dot",
      "",
    ]) {
      expect(isValidNickname(bad)).toBe(false);
    }
  });

  it("reports a taken nickname, case-insensitively", async () => {
    expect(await isNicknameAvailable(db, "ilya")).toBe(false);

    // A row that predates the lowercase rule must still block the lowercase form.
    await db
      .insert(profiles)
      .values({ userId: otherUserId, nickname: "Legacy-Name" });
    expect(await isNicknameAvailable(db, "legacy-name")).toBe(false);
  });

  it("reports a free nickname", async () => {
    expect(await isNicknameAvailable(db, "not-taken-yet")).toBe(true);
  });

  it("ignores the excluded user's own nickname", async () => {
    expect(await isNicknameAvailable(db, "ilya", userId)).toBe(true);
    expect(await isNicknameAvailable(db, "ilya", otherUserId)).toBe(false);
  });

  it("throws NicknameTakenError when another user already holds it", async () => {
    const claimant = await createUser(db);
    await upsertProfile(db, { userId: claimant, nickname: "shared-name" });

    const latecomer = await createUser(db);
    await expect(
      upsertProfile(db, { userId: latecomer, nickname: "shared-name" }),
    ).rejects.toBeInstanceOf(NicknameTakenError);

    // Also on the update path, and case-insensitively.
    await upsertProfile(db, { userId: latecomer, nickname: "own-name" });
    await expect(
      upsertProfile(db, { userId: latecomer, nickname: "shared-name" }),
    ).rejects.toThrow(/already taken/);

    expect(await getProfile(db, latecomer)).toMatchObject({
      nickname: "own-name",
    });
  });

  it("never reports an invalid nickname as available", async () => {
    for (const bad of ["ab", "Ilya", "with space", "x".repeat(31)]) {
      expect(await isNicknameAvailable(db, bad)).toBe(false);
    }
  });

  describe("getProfileByNickname", () => {
    it("resolves a public list URL to its owner", async () => {
      const profile = await getProfileByNickname(db, "ilya");
      expect(profile).toMatchObject({ userId, nickname: "ilya" });
    });

    it("matches the nickname case-insensitively", async () => {
      const profile = await getProfileByNickname(db, "ILYA");
      expect(profile?.userId).toBe(userId);
    });

    it("returns null for a nickname no one holds", async () => {
      expect(await getProfileByNickname(db, "nobody-here")).toBeNull();
    });
  });
});
