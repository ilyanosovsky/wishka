// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `@/db` is marked server-only, which throws outside React's server condition.
vi.mock("server-only", () => ({}));

import { wishes } from "@/db/schema";
import {
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "@/db/test-support";
import { eq } from "drizzle-orm";
import {
  finishImageGeneration,
  getImageState,
  startImageGeneration,
} from "./wish-image";

/** On our own storage host: with no UPLOADTHING_TOKEN in the test env the host
 *  policy is `loose`, so any `*.ufs.sh/f/<key>` URL is recognised as ours. */
const OURS = "https://app123.ufs.sh/f/generated-image";
const FOREIGN = "https://evil.example/cat.png";
const MISSING = "00000000-0000-4000-8000-000000000000";

describe("wish image state machine", () => {
  let ctx: TestDb;
  let ownerId: string;
  let strangerId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    ownerId = await createUser(ctx.db);
    strangerId = await createUser(ctx.db);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const newWish = (values: Partial<typeof wishes.$inferInsert> = {}) =>
    createWish(ctx.db, { ownerId, title: "Vase", ...values });

  const statusOf = async (wishId: string) => {
    const [row] = await ctx.db
      .select({ status: wishes.imageStatus, key: wishes.imageKey })
      .from(wishes)
      .where(eq(wishes.id, wishId));
    return row;
  };

  it("never mentions the booking table in its source", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/db/access/wish-image.ts"),
      "utf8",
    );
    expect(source).not.toContain("reservations");
  });

  describe("startImageGeneration", () => {
    it("arms a wish that has no picture", async () => {
      const wishId = await newWish();
      expect(await startImageGeneration(ctx.db, ownerId, wishId)).toBe(
        "started",
      );
      expect((await statusOf(wishId)).status).toBe("generating");
    });

    it("restarts a failed wish (retry from the card)", async () => {
      const wishId = await newWish({ imageStatus: "failed" });
      expect(await startImageGeneration(ctx.db, ownerId, wishId)).toBe(
        "started",
      );
      expect((await statusOf(wishId)).status).toBe("generating");
    });

    it("restarts a wish stuck in generating", async () => {
      const wishId = await newWish({ imageStatus: "generating" });
      expect(await startImageGeneration(ctx.db, ownerId, wishId)).toBe(
        "started",
      );
      expect((await statusOf(wishId)).status).toBe("generating");
    });

    it("answers not_found for someone else's wish, leaving it untouched", async () => {
      const wishId = await newWish({ imageKey: OURS, imageStatus: "ready" });
      expect(await startImageGeneration(ctx.db, strangerId, wishId)).toBe(
        "not_found",
      );
      expect(await statusOf(wishId)).toEqual({ status: "ready", key: OURS });
    });

    it("answers not_found for a missing wish and for a non-uuid id", async () => {
      expect(await startImageGeneration(ctx.db, ownerId, MISSING)).toBe(
        "not_found",
      );
      expect(await startImageGeneration(ctx.db, ownerId, "not-a-uuid")).toBe(
        "not_found",
      );
    });
  });

  describe("finishImageGeneration", () => {
    it("stores the picture and flips to ready", async () => {
      const wishId = await newWish({ imageStatus: "generating" });
      expect(await finishImageGeneration(ctx.db, wishId, OURS)).toBe(true);
      expect(await statusOf(wishId)).toEqual({ status: "ready", key: OURS });
    });

    it("flips to failed on null", async () => {
      const wishId = await newWish({ imageStatus: "generating" });
      expect(await finishImageGeneration(ctx.db, wishId, null)).toBe(true);
      expect((await statusOf(wishId)).status).toBe("failed");
    });

    it("fails a wish that already had a picture, keeping the old key", async () => {
      // §6.2: the card must offer retry / upload rather than quietly pretend
      // the old image is the generated one.
      const wishId = await newWish({
        imageKey: OURS,
        imageStatus: "generating",
      });
      expect(await finishImageGeneration(ctx.db, wishId, null)).toBe(true);
      expect(await statusOf(wishId)).toEqual({ status: "failed", key: OURS });
    });

    it("refuses a URL that is not on our storage (invariant #6)", async () => {
      const wishId = await newWish({ imageStatus: "generating" });
      expect(await finishImageGeneration(ctx.db, wishId, FOREIGN)).toBe(true);
      expect(await statusOf(wishId)).toEqual({ status: "failed", key: null });
    });

    it("CLOBBER GUARD: a photo uploaded during the job wins", async () => {
      // The owner got bored and uploaded their own picture: the row left
      // `generating`, so the late job must not overwrite it. Without the
      // `image_status = 'generating'` clause in the WHERE this test fails.
      const wishId = await newWish({
        imageKey: "https://app123.ufs.sh/f/user-photo",
        imageStatus: "ready",
      });
      expect(await finishImageGeneration(ctx.db, wishId, OURS)).toBe(false);
      expect(await statusOf(wishId)).toEqual({
        status: "ready",
        key: "https://app123.ufs.sh/f/user-photo",
      });
    });

    it("CLOBBER GUARD: a failure cannot fail a wish that already moved on", async () => {
      const wishId = await newWish({
        imageKey: "https://app123.ufs.sh/f/user-photo",
        imageStatus: "ready",
      });
      expect(await finishImageGeneration(ctx.db, wishId, null)).toBe(false);
      expect((await statusOf(wishId)).status).toBe("ready");
    });

    it("is a no-op for a missing wish or a non-uuid id", async () => {
      expect(await finishImageGeneration(ctx.db, MISSING, OURS)).toBe(false);
      expect(await finishImageGeneration(ctx.db, "not-a-uuid", OURS)).toBe(
        false,
      );
    });

    it("only the first of two racing jobs lands (the second is superseded)", async () => {
      const wishId = await newWish({ imageStatus: "generating" });
      expect(await finishImageGeneration(ctx.db, wishId, OURS)).toBe(true);
      expect(await finishImageGeneration(ctx.db, wishId, null)).toBe(false);
      expect(await statusOf(wishId)).toEqual({ status: "ready", key: OURS });
    });
  });

  describe("getImageState", () => {
    it("returns the owner's current state", async () => {
      const wishId = await newWish({ imageKey: OURS, imageStatus: "ready" });
      expect(await getImageState(ctx.db, ownerId, wishId)).toEqual({
        imageStatus: "ready",
        imageUrl: OURS,
      });
    });

    it("answers null for a foreign wish exactly like a missing one", async () => {
      const wishId = await newWish();
      expect(await getImageState(ctx.db, strangerId, wishId)).toBeNull();
      expect(await getImageState(ctx.db, strangerId, MISSING)).toBeNull();
      expect(await getImageState(ctx.db, ownerId, "not-a-uuid")).toBeNull();
    });
  });
});
