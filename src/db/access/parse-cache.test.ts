// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ParseFields } from "@/lib/parse/types";
import type { Db } from "../index";
import { parsedUrlCache } from "../schema";
import { createTestDb, type TestDb } from "../test-support";
import { getCachedParse, saveParse } from "./parse-cache";

const URL_A = "https://shop.example/products/vase";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const FIELDS: ParseFields = {
  title: "Handmade Ceramic Vase",
  description: "Hand-thrown stoneware.",
  imageUrl: "https://app123.ufs.sh/f/abcdef123456",
  priceMin: "129.00",
  priceMax: null,
  currency: "GEL",
};

const DAY = 24 * 60 * 60 * 1000;

describe("parsed URL cache", () => {
  let ctx: TestDb;
  let db: Db;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("misses on an unknown hash", async () => {
    expect(await getCachedParse(db, HASH_B)).toBeNull();
  });

  it("round-trips a parse", async () => {
    await saveParse(db, HASH_A, URL_A, { status: "ok", fields: FIELDS });

    const cached = await getCachedParse(db, HASH_A);
    expect(cached?.status).toBe("ok");
    expect(cached?.fields).toEqual(FIELDS);
    expect(cached?.cachedAt).toBeInstanceOf(Date);
  });

  it("keeps a row that is a day short of the TTL", async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * DAY);
    await saveParse(
      db,
      HASH_B,
      "https://shop.example/p/mug",
      { status: "partial", fields: { ...FIELDS, priceMin: null } },
      sixDaysAgo,
    );

    const cached = await getCachedParse(db, HASH_B);
    expect(cached?.status).toBe("partial");
    expect(cached?.fields.priceMin).toBeNull();
  });

  it("treats a row older than the 7-day TTL as a miss", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * DAY);
    await saveParse(
      db,
      HASH_B,
      "https://shop.example/p/mug",
      { status: "ok", fields: FIELDS },
      eightDaysAgo,
    );

    expect(await getCachedParse(db, HASH_B)).toBeNull();
  });

  it("upserts: a re-parse replaces the payload and restarts the TTL", async () => {
    await saveParse(
      db,
      HASH_B,
      "https://shop.example/p/mug",
      { status: "ok", fields: { ...FIELDS, title: "Fresh title" } },
      new Date(),
    );

    const cached = await getCachedParse(db, HASH_B);
    expect(cached?.fields.title).toBe("Fresh title");

    const rows = await db
      .select()
      .from(parsedUrlCache)
      .where(eq(parsedUrlCache.urlHash, HASH_B));
    expect(rows).toHaveLength(1);
  });

  const failedFields = {
    title: null,
    description: null,
    imageUrl: null,
    priceMin: null,
    priceMax: null,
    currency: null,
  };

  it("caches a fresh failure to spare an immediate retry storm", async () => {
    const hash = "c".repeat(64);
    await saveParse(db, hash, "https://blocked.example/p/1", {
      status: "failed",
      fields: failedFields,
    });

    expect((await getCachedParse(db, hash))?.status).toBe("failed");
  });

  it("expires a cached failure after 30 minutes, not 7 days", async () => {
    const hash = "e".repeat(64);
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000);
    await saveParse(
      db,
      hash,
      "https://blocked.example/p/2",
      { status: "failed", fields: failedFields },
      fortyMinAgo,
    );

    // A transient block must not poison the shared cache for a whole week.
    expect(await getCachedParse(db, hash)).toBeNull();

    // A success of the same age is still served — its TTL is the full 7 days.
    const okHash = "f".repeat(64);
    await saveParse(
      db,
      okHash,
      "https://shop.example/p/ok",
      { status: "ok", fields: FIELDS },
      fortyMinAgo,
    );
    expect((await getCachedParse(db, okHash))?.status).toBe("ok");
  });

  it("reads a row with an unrecognisable payload as a miss", async () => {
    const hash = "d".repeat(64);
    await db.insert(parsedUrlCache).values({
      urlHash: hash,
      url: URL_A,
      data: { legacy: true },
    });

    expect(await getCachedParse(db, hash)).toBeNull();
  });
});
