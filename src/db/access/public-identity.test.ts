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
  let blankNameId: string;
  let blankSpacesId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    userId = await createUser(db, {
      name: "Маша",
      image: "https://app123.ufs.sh/f/avatar-masha",
    });
    namelessId = await createUser(db, { name: "Петя" });
    // Exactly what Better Auth's email-OTP signup writes when the caller
    // passes no name — and what «Пропустить» on /welcome leaves behind.
    blankNameId = await createUser(db, { name: "" });
    blankSpacesId = await createUser(db, { name: "   " });
    await upsertProfile(db, { userId, nickname: "masha" });
    await upsertProfile(db, { userId: namelessId, nickname: "petya" });
    await upsertProfile(db, { userId: blankNameId, nickname: "wisher-3f2a" });
    await upsertProfile(db, { userId: blankSpacesId, nickname: "wisher-91cc" });
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

  /**
   * `"" ?? nickname` is `""`, so an un-normalized empty name slipped past every
   * call site's guard and rendered a blank `<h1>`, «Из списка: » with nothing
   * after the colon, and a `" · Wishka"` title. Normalizing in SQL is what
   * makes those `??` fallbacks fire at all.
   */
  it("reports a blank name as null so the nickname fallback can fire", async () => {
    expect(await getPublicIdentityByUserId(db, blankNameId)).toMatchObject({
      nickname: "wisher-3f2a",
      name: null,
    });
    expect(await getPublicIdentityByNickname(db, "wisher-3f2a")).toMatchObject({
      name: null,
    });
  });

  it("treats a whitespace-only name as no name", async () => {
    expect(await getPublicIdentityByUserId(db, blankSpacesId)).toMatchObject({
      nickname: "wisher-91cc",
      name: null,
    });
  });

  it("the page-level fallback resolves a nameless owner to their nickname", async () => {
    const identity = await getPublicIdentityByNickname(db, "wisher-3f2a");
    // The exact expression `/u/[nickname]` and `/w/[id]` apply.
    expect(identity?.name ?? identity?.nickname).toBe("wisher-3f2a");
    const named = await getPublicIdentityByNickname(db, "masha");
    expect(named?.name ?? named?.nickname).toBe("Маша");
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
