// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { profiles } from "../schema";
import {
  addGroupMember,
  createGroup,
  createTestDb,
  createUser,
  type TestDb,
} from "../test-support";
import {
  clearPartner,
  getProfile,
  getProfileByNickname,
  isNicknameAvailable,
  isValidNickname,
  NicknameTakenError,
  setPartner,
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

  /** §6.6 «Тап по нику → смена ника»: the profile-edit action passes ONLY
   *  `nickname`, so the generated SET list must not touch anything else. */
  describe("nickname-only rename (profile edit)", () => {
    it("keeps every other column when only the nickname is written", async () => {
      const renamer = await createUser(db);
      const mate = await createUser(db);
      const groupId = await createGroup(db, renamer, [renamer]);
      await addGroupMember(db, { groupId, userId: mate, role: "member" });

      await upsertProfile(db, {
        userId: renamer,
        nickname: "old-nick",
        baseCurrency: "GEL",
        sizes: { clothing: "M", рост: "180" },
        tastes: ["tea"],
        noGift: ["socks"],
      });
      await setPartner(db, renamer, mate);

      await upsertProfile(db, { userId: renamer, nickname: "new-nick" });

      expect(await getProfile(db, renamer)).toMatchObject({
        nickname: "new-nick",
        baseCurrency: "GEL",
        partnerId: mate,
        sizes: { clothing: "M", рост: "180" },
        tastes: ["tea"],
        noGift: ["socks"],
      });
      // The old public URL stops resolving — that is the whole point of the
      // «Старая ссылка перестанет работать» warning.
      expect(await getProfileByNickname(db, "old-nick")).toBeNull();
      expect(await getProfileByNickname(db, "new-nick")).toMatchObject({
        userId: renamer,
      });
    });

    it("refuses a rename onto someone else's nickname and leaves the old one intact", async () => {
      const holder = await createUser(db);
      await upsertProfile(db, { userId: holder, nickname: "wanted-nick" });
      const renamer = await createUser(db);
      await upsertProfile(db, { userId: renamer, nickname: "keeps-this" });

      await expect(
        upsertProfile(db, { userId: renamer, nickname: "wanted-nick" }),
      ).rejects.toBeInstanceOf(NicknameTakenError);

      expect(await getProfile(db, renamer)).toMatchObject({
        nickname: "keeps-this",
      });
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

  describe("setPartner / clearPartner", () => {
    it("refuses partnering yourself", async () => {
      expect(await setPartner(db, userId, userId)).toEqual({
        ok: false,
        error: "self",
      });
    });

    it("refuses a partner who shares no group", async () => {
      await upsertProfile(db, { userId: otherUserId, nickname: "stranger" });
      expect(await setPartner(db, userId, otherUserId)).toEqual({
        ok: false,
        error: "not_shared",
      });
    });

    it("sets a partner who is a co-member of a shared group, leaving other columns untouched", async () => {
      const partnerId = await createUser(db);
      await upsertProfile(db, {
        userId,
        nickname: "ilya",
        baseCurrency: "EUR",
        tastes: ["coffee"],
      });
      const groupId = await createGroup(db, userId, [userId]);
      await addGroupMember(db, { groupId, userId: partnerId, role: "member" });

      const result = await setPartner(db, userId, partnerId);
      expect(result).toEqual({ ok: true });

      const profile = await getProfile(db, userId);
      expect(profile).toMatchObject({
        partnerId,
        baseCurrency: "EUR",
        tastes: ["coffee"],
      });
    });

    it("clears a partner without touching other columns", async () => {
      const partnerId = await createUser(db);
      const groupId = await createGroup(db, userId, [userId]);
      await addGroupMember(db, { groupId, userId: partnerId, role: "member" });
      await setPartner(db, userId, partnerId);

      expect(await clearPartner(db, userId)).toEqual({ ok: true });

      const profile = await getProfile(db, userId);
      expect(profile?.partnerId).toBeNull();
    });

    it("reports not_found for a user with no profile row", async () => {
      const noProfileUser = await createUser(db);
      const groupId = await createGroup(db, noProfileUser, [noProfileUser]);
      const partnerId = await createUser(db);
      await addGroupMember(db, { groupId, userId: partnerId, role: "member" });

      expect(await setPartner(db, noProfileUser, partnerId)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(await clearPartner(db, noProfileUser)).toEqual({ ok: false });
    });
  });
});
