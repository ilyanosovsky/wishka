// @vitest-environment node
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
import { getOwnerWish } from "@/db/access/owner";
import { aiUsage } from "@/db/schema";
import { usageDay } from "@/lib/parse/quota";
import { and, eq } from "drizzle-orm";
import type { AiImageClient } from "./client";
import {
  armImageGeneration,
  runImageGenerationJob,
  type ScheduledImageJob,
} from "./image-job";
import { DAILY_IMAGE_LIMIT } from "./quota";

const OURS = "https://app123.ufs.sh/f/generated";
const PIXEL = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** A model that answers with whatever the test hands it. */
function fakeClient(
  answer: Uint8Array | null | Error,
): AiImageClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async generate(prompt) {
      calls.push(prompt);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("runImageGenerationJob", () => {
  let ctx: TestDb;
  let ownerId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    ownerId = await createUser(ctx.db);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const armedWish = () =>
    createWish(ctx.db, {
      ownerId,
      title: "Ваза",
      imageStatus: "generating",
    });

  const rowOf = async (wishId: string) => {
    const [row] = await ctx.db
      .select({ status: wishes.imageStatus, key: wishes.imageKey })
      .from(wishes)
      .where(eq(wishes.id, wishId));
    return row;
  };

  it("stores the picture and lands on ready", async () => {
    const wishId = await armedWish();
    const storagePut = vi.fn().mockResolvedValue({ url: OURS });
    const imageClient = fakeClient(PIXEL);

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient,
      storagePut,
    });

    expect(imageClient.calls).toEqual(["a vase"]);
    expect(storagePut).toHaveBeenCalledWith(
      PIXEL,
      `wish-ai-${wishId}.png`,
      "image/png",
    );
    expect(await rowOf(wishId)).toEqual({ status: "ready", key: OURS });
  });

  it("lands on failed when the model returns nothing", async () => {
    const wishId = await armedWish();
    const storagePut = vi.fn();

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(null),
      storagePut,
    });

    expect(storagePut).not.toHaveBeenCalled();
    expect((await rowOf(wishId)).status).toBe("failed");
  });

  it("lands on failed when the model throws", async () => {
    const wishId = await armedWish();

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(new Error("boom")),
      storagePut: vi.fn(),
    });

    expect((await rowOf(wishId)).status).toBe("failed");
  });

  it("lands on failed when the upload rejects", async () => {
    const wishId = await armedWish();

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(PIXEL),
      storagePut: vi.fn().mockRejectedValue(new Error("bucket down")),
    });

    expect((await rowOf(wishId)).status).toBe("failed");
  });

  it("lands on failed when the upload answers without a URL", async () => {
    const wishId = await armedWish();

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(PIXEL),
      storagePut: vi.fn().mockResolvedValue(undefined),
    });

    expect((await rowOf(wishId)).status).toBe("failed");
  });

  it("refuses a payload above the 8MB cap without uploading it", async () => {
    const wishId = await armedWish();
    const storagePut = vi.fn();
    const bomb = new Uint8Array(8 * 1024 * 1024 + 1);

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(bomb),
      storagePut,
    });

    expect(storagePut).not.toHaveBeenCalled();
    expect((await rowOf(wishId)).status).toBe("failed");
  });

  it("refuses an empty payload", async () => {
    const wishId = await armedWish();
    const storagePut = vi.fn();

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(new Uint8Array(0)),
      storagePut,
    });

    expect(storagePut).not.toHaveBeenCalled();
    expect((await rowOf(wishId)).status).toBe("failed");
  });

  it("never throws, even when the terminal write itself fails", async () => {
    // `after()` has nobody to catch for it: an escaping rejection would take
    // down the whole post-response phase.
    const brokenDb = {
      update() {
        throw new Error("database gone");
      },
    } as unknown as TestDb["db"];

    await expect(
      runImageGenerationJob({
        db: brokenDb,
        wishId: "00000000-0000-4000-8000-000000000000",
        prompt: "a vase",
        imageClient: fakeClient(PIXEL),
        storagePut: vi.fn().mockResolvedValue({ url: OURS }),
      }),
    ).resolves.toBeUndefined();
  });

  it("does not overwrite a photo the owner uploaded while it ran", async () => {
    const own = "https://app123.ufs.sh/f/user-photo";
    const wishId = await createWish(ctx.db, {
      ownerId,
      title: "Ваза",
      imageKey: own,
      imageStatus: "ready",
    });

    await runImageGenerationJob({
      db: ctx.db,
      wishId,
      prompt: "a vase",
      imageClient: fakeClient(PIXEL),
      storagePut: vi.fn().mockResolvedValue({ url: OURS }),
    });

    expect(await rowOf(wishId)).toEqual({ status: "ready", key: own });
  });
});

describe("armImageGeneration", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** A user, their wish, and a scheduler that records instead of running. */
  async function arm(
    options: { imageUsed?: number; wishId?: string } = {},
  ): Promise<{
    userId: string;
    wishId: string;
    scheduled: ScheduledImageJob[];
    result: Awaited<ReturnType<typeof armImageGeneration>>;
    status: string;
  }> {
    const userId = await createUser(ctx.db);
    const wishId =
      options.wishId ??
      (await createWish(ctx.db, { ownerId: userId, title: "Ваза" }));
    if (options.imageUsed) {
      await ctx.db.insert(aiUsage).values({
        userId,
        day: usageDay(),
        kind: "image",
        count: options.imageUsed,
      });
    }

    // A wish the caller has already resolved as owned — including the case
    // where `options.wishId` belongs to somebody else, which is what the
    // "vanished under us" test needs.
    const wish = (await getOwnerWish(ctx.db, userId, wishId)) ?? {
      id: wishId,
      ownerId: userId,
      type: "product" as const,
      title: "Ваза",
      url: null,
      imageKey: null,
      imageStatus: "none" as const,
      description: null,
      priceType: "none" as const,
      priceMin: null,
      priceMax: null,
      currency: null,
      priority: "nice" as const,
      isDream: false,
      category: null,
      notes: null,
      visibility: "everyone" as const,
      status: "active" as const,
      giftedAt: null,
      giftedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const scheduled: ScheduledImageJob[] = [];
    const result = await armImageGeneration({
      db: ctx.db,
      userId,
      wish,
      imageClient: fakeClient(PIXEL),
      storagePut: vi.fn().mockResolvedValue({ url: OURS }),
      schedule: (job) => scheduled.push(job),
    });

    const [row] = await ctx.db
      .select({ status: wishes.imageStatus })
      .from(wishes)
      .where(eq(wishes.id, wishId));
    return { userId, wishId, scheduled, result, status: row?.status ?? "gone" };
  }

  it("consumes the quota, flips the row and schedules exactly one job", async () => {
    const { userId, wishId, scheduled, result, status } = await arm();

    expect(result).toBe("armed");
    expect(status).toBe("generating");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].wishId).toBe(wishId);
    // The prompt is built from the wish, not from the caller.
    expect(scheduled[0].prompt).toContain("Ваза");

    const [usage] = await ctx.db
      .select({ count: aiUsage.count })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), eq(aiUsage.kind, "image")));
    expect(usage.count).toBe(1);
  });

  it("QUOTA REFUSAL leaves the wish untouched and schedules nothing", async () => {
    const { scheduled, result, status } = await arm({
      imageUsed: DAILY_IMAGE_LIMIT,
    });

    expect(result).toBe("quota");
    // The row must NOT be parked in `generating` with no job coming for it.
    expect(status).toBe("none");
    expect(scheduled).toEqual([]);
  });

  it("does not schedule a job for a wish that vanished under us", async () => {
    const stranger = await createUser(ctx.db);
    const foreign = await createWish(ctx.db, {
      ownerId: stranger,
      title: "Чужая ваза",
    });

    const { scheduled, result, status } = await arm({ wishId: foreign });

    expect(result).toBe("not_found");
    expect(scheduled).toEqual([]);
    // Someone else's wish is not touched by the flip.
    expect(status).toBe("none");
  });
});
