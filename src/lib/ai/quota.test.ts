// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `@/db` is marked server-only, which throws outside React's server condition.
vi.mock("server-only", () => ({}));

import { aiUsage } from "@/db/schema";
import { createTestDb, createUser, type TestDb } from "@/db/test-support";
import { usageDay } from "@/lib/parse/quota";
import { and, eq } from "drizzle-orm";
import {
  consumeAiQuota,
  DAILY_IMAGE_LIMIT,
  DAILY_TEXT_LIMIT,
  getAiQuotaRemaining,
} from "./quota";

describe("consumeAiQuota", () => {
  let ctx: TestDb;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    userId = await createUser(ctx.db);
    otherId = await createUser(ctx.db);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("allows the whole text budget and refuses the next call", async () => {
    for (let i = 0; i < DAILY_TEXT_LIMIT; i += 1) {
      expect(await consumeAiQuota(ctx.db, userId, "text")).toBe(true);
    }
    expect(await consumeAiQuota(ctx.db, userId, "text")).toBe(false);

    const [row] = await ctx.db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), eq(aiUsage.kind, "text")));
    expect(row.count).toBe(DAILY_TEXT_LIMIT + 1);
    expect(row.day).toBe(usageDay());
  });

  it("allows the whole image budget and refuses the next call", async () => {
    for (let i = 0; i < DAILY_IMAGE_LIMIT; i += 1) {
      expect(await consumeAiQuota(ctx.db, userId, "image")).toBe(true);
    }
    expect(await consumeAiQuota(ctx.db, userId, "image")).toBe(false);
  });

  it("keeps the two pools independent (image is not spent by text)", async () => {
    // `userId` exhausted text above; a fresh user spends only the image pool.
    expect(await consumeAiQuota(ctx.db, otherId, "image")).toBe(true);
    const remaining = await getAiQuotaRemaining(ctx.db, otherId);
    expect(remaining.text).toBe(DAILY_TEXT_LIMIT);
    expect(remaining.image).toBe(DAILY_IMAGE_LIMIT - 1);
  });

  it("counts per user", async () => {
    expect(await consumeAiQuota(ctx.db, otherId, "text")).toBe(true);
  });

  it("counts per day", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(await consumeAiQuota(ctx.db, userId, "text", tomorrow)).toBe(true);
    expect(await consumeAiQuota(ctx.db, userId, "image", tomorrow)).toBe(true);
  });

  it("does not share a counter with parsing or uploads", async () => {
    const parser = await createUser(ctx.db);
    await ctx.db
      .insert(aiUsage)
      .values({ userId: parser, day: usageDay(), kind: "parse", count: 49 });
    await ctx.db
      .insert(aiUsage)
      .values({ userId: parser, day: usageDay(), kind: "upload", count: 19 });

    expect(await consumeAiQuota(ctx.db, parser, "text")).toBe(true);
    expect(await getAiQuotaRemaining(ctx.db, parser)).toEqual({
      text: DAILY_TEXT_LIMIT - 1,
      image: DAILY_IMAGE_LIMIT,
    });
  });
});

describe("getAiQuotaRemaining", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("reports full budgets for a user who has never used AI", async () => {
    const fresh = await createUser(ctx.db);
    expect(await getAiQuotaRemaining(ctx.db, fresh)).toEqual({
      text: DAILY_TEXT_LIMIT,
      image: DAILY_IMAGE_LIMIT,
    });
  });

  it("clamps at zero once the refused call has overrun the limit", async () => {
    const spent = await createUser(ctx.db);
    await ctx.db.insert(aiUsage).values({
      userId: spent,
      day: usageDay(),
      kind: "text",
      count: DAILY_TEXT_LIMIT + 5,
    });
    const remaining = await getAiQuotaRemaining(ctx.db, spent);
    expect(remaining.text).toBe(0);
    expect(remaining.image).toBe(DAILY_IMAGE_LIMIT);
  });

  it("never increments anything", async () => {
    const reader = await createUser(ctx.db);
    await getAiQuotaRemaining(ctx.db, reader);
    await getAiQuotaRemaining(ctx.db, reader);

    const rows = await ctx.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.userId, reader));
    expect(rows).toHaveLength(0);
  });

  it("rolls over: yesterday's spending does not touch today", async () => {
    const user = await createUser(ctx.db);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await ctx.db.insert(aiUsage).values({
      userId: user,
      day: usageDay(yesterday),
      kind: "image",
      count: DAILY_IMAGE_LIMIT,
    });

    expect(await getAiQuotaRemaining(ctx.db, user, yesterday)).toEqual({
      text: DAILY_TEXT_LIMIT,
      image: 0,
    });
    expect(await getAiQuotaRemaining(ctx.db, user)).toEqual({
      text: DAILY_TEXT_LIMIT,
      image: DAILY_IMAGE_LIMIT,
    });
  });
});
