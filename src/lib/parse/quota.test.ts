// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `@/db` is marked server-only, which throws outside React's server condition.
vi.mock("server-only", () => ({}));

import { aiUsage } from "@/db/schema";
import { createTestDb, createUser, type TestDb } from "@/db/test-support";
import { and, eq } from "drizzle-orm";
import { consumeParseQuota, DAILY_PARSE_LIMIT, usageDay } from "./quota";

describe("consumeParseQuota", () => {
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

  it("allows the whole daily budget and refuses the next call", async () => {
    for (let i = 0; i < DAILY_PARSE_LIMIT; i += 1) {
      expect(await consumeParseQuota(ctx.db, userId)).toBe(true);
    }
    expect(await consumeParseQuota(ctx.db, userId)).toBe(false);

    const [row] = await ctx.db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), eq(aiUsage.kind, "parse")));
    expect(row.count).toBe(DAILY_PARSE_LIMIT + 1);
    expect(row.day).toBe(usageDay());
  });

  it("counts per user", async () => {
    expect(await consumeParseQuota(ctx.db, otherId)).toBe(true);
  });

  it("counts per day", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(await consumeParseQuota(ctx.db, userId, tomorrow)).toBe(true);
  });

  it("does not share a counter with uploads or image generation", async () => {
    await ctx.db
      .insert(aiUsage)
      .values({ userId: otherId, day: usageDay(), kind: "upload", count: 19 });

    expect(await consumeParseQuota(ctx.db, otherId)).toBe(true);

    const [upload] = await ctx.db
      .select()
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, otherId), eq(aiUsage.kind, "upload")));
    expect(upload.count).toBe(19);
  });

  it("is the only new kind the constraint learned (migration 0002)", async () => {
    // 'parse' is exercised by every test above; the constraint must still
    // refuse anything outside the union. The cast is the point of the test:
    // the TypeScript union and the CHECK have to agree.
    const invalid = {
      userId,
      day: "2020-01-01",
      kind: "nonsense",
      count: 1,
    } as unknown as typeof aiUsage.$inferInsert;

    await expect(
      (async () => {
        await ctx.db.insert(aiUsage).values(invalid);
      })(),
    ).rejects.toThrow();
  });
});
