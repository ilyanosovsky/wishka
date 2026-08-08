// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `lib/storage/uploadthing` (for extractStorageKey) is marked server-only,
// which throws outside React's server condition. The marker carries no
// behaviour, so stubbing it away is faithful.
vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";

import type { Db } from "../index";
import { wishes } from "../schema";
import { createTestDb, createUser, type TestDb } from "../test-support";
import { getOwnerWish, getOwnerWishes } from "./owner";
import { finishImageGeneration } from "./wish-image";
import {
  createWish,
  deleteWish,
  markGifted,
  restoreWish,
  updateWish,
  type WishInput,
} from "./mutations";

const OURS = "https://app123.ufs.sh/f/abcdef123456";
const OURS_TOO = "https://app123.ufs.sh/f/999888777666";
const FOREIGN = "https://cdn.some-shop.com/images/vase.jpg";
const MISSING_UUID = "11111111-2222-3333-4444-555555555555";

function input(overrides: Partial<WishInput> = {}): WishInput {
  return {
    type: "product",
    title: "Ceramic vase",
    priceType: "none",
    priority: "nice",
    isDream: false,
    ...overrides,
  };
}

async function ok(db: Db, ownerId: string, overrides: Partial<WishInput> = {}) {
  const result = await createWish(db, ownerId, input(overrides));
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.wish;
}

describe("wish mutations", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let strangerId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db);
    strangerId = await createUser(db);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("validation", () => {
    const cases: [string, Partial<WishInput>, string][] = [
      ["empty title", { title: "" }, "title"],
      ["blank title", { title: "   " }, "title"],
      ["title over 200 chars", { title: "x".repeat(201) }, "title"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the point is a payload that TypeScript would refuse
      ["unknown type", { type: "gadget" as any }, "type"],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto: priority is a closed union at the type level
      ["unknown priority", { priority: "urgent" as any }, "type"],
      ["unknown category", { category: "vehicles" }, "category"],
      [
        "exact price without an amount",
        { priceType: "exact" as const, currency: "EUR" },
        "price",
      ],
      [
        "exact price of zero",
        { priceType: "exact" as const, priceMin: "0", currency: "EUR" },
        "price",
      ],
      [
        "negative price",
        { priceType: "exact" as const, priceMin: "-5", currency: "EUR" },
        "price",
      ],
      [
        "non-numeric price",
        { priceType: "exact" as const, priceMin: "1 400 GEL", currency: "GEL" },
        "price",
      ],
      [
        "range with no upper bound",
        { priceType: "range" as const, priceMin: "10", currency: "USD" },
        "price",
      ],
      [
        "inverted range",
        {
          priceType: "range" as const,
          priceMin: "300",
          priceMax: "100",
          currency: "USD",
        },
        "price",
      ],
      [
        "price without a currency",
        { priceType: "exact" as const, priceMin: "10" },
        "currency",
      ],
      [
        "malformed currency",
        { priceType: "exact" as const, priceMin: "10", currency: "EU" },
        "currency",
      ],
      ["image on a foreign host", { imageUrl: FOREIGN }, "image"],
      ["image that is not a url", { imageUrl: "just-a-key" }, "image"],
      // The url is rendered as an <a href> — only http(s) may be stored.
      ["a javascript: url", { url: "javascript:alert(1)" }, "url"],
      [
        "a data: url",
        { url: "data:text/html,<script>alert(1)</script>" },
        "url",
      ],
      ["a non-web scheme", { url: "ftp://files.example/vase" }, "url"],
      ["a url with no scheme", { url: "shop.example/vase" }, "url"],
      ["a url that is only a scheme", { url: "https://" }, "url"],
    ];

    for (const [name, overrides, error] of cases) {
      it(`rejects ${name}`, async () => {
        const result = await createWish(db, ownerId, input(overrides));
        expect(result).toEqual({ ok: false, error });
      });
    }

    it("accepts http and https urls", async () => {
      const secure = await ok(db, ownerId, { url: "https://shop.example/x" });
      expect(secure.url).toBe("https://shop.example/x");
      const plain = await ok(db, ownerId, { url: "http://shop.example/x" });
      expect(plain.url).toBe("http://shop.example/x");
    });

    it("answers hand-crafted non-string payloads with an error, not a crash", async () => {
      /* eslint-disable @typescript-eslint/no-explicit-any -- server actions are
         a trust boundary: `WishInput` is what we asked for, not what arrives. */
      expect(
        await createWish(db, ownerId, input({ title: 42 as any })),
      ).toEqual({ ok: false, error: "title" });

      expect(
        await createWish(
          db,
          ownerId,
          input({ priceType: "exact", priceMin: 100 as any, currency: "EUR" }),
        ),
      ).toEqual({ ok: false, error: "price" });

      expect(
        await createWish(
          db,
          ownerId,
          input({ priceType: "exact", priceMin: "10", currency: 978 as any }),
        ),
      ).toEqual({ ok: false, error: "currency" });

      // Optional free text that isn't text reads as absent rather than fatal.
      const wish = await ok(db, ownerId, {
        url: {} as any,
        notes: [] as any,
        category: 7 as any,
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
      expect(wish.url).toBeNull();
      expect(wish.notes).toBeNull();
      expect(wish.category).toBeNull();
    });

    it("accepts a bare title and defaults the rest", async () => {
      const wish = await ok(db, ownerId, { title: "  Trimmed  " });
      expect(wish.title).toBe("Trimmed");
      expect(wish.status).toBe("active");
      expect(wish.visibility).toBe("everyone");
      expect(wish.imageStatus).toBe("none");
      expect(wish.priceType).toBe("none");
    });

    it("accepts an equal-bounds range and upper-cases the currency", async () => {
      const wish = await ok(db, ownerId, {
        priceType: "range",
        priceMin: "800",
        priceMax: "800",
        currency: "gel",
      });
      expect(wish.priceMin).toBe("800.00");
      expect(wish.priceMax).toBe("800.00");
      expect(wish.currency).toBe("GEL");
    });

    it("accepts a comma as the decimal separator", async () => {
      const wish = await ok(db, ownerId, {
        priceType: "exact",
        priceMin: "19,90",
        currency: "EUR",
      });
      expect(wish.priceMin).toBe("19.90");
    });

    it("nulls the price fields when priceType is none", async () => {
      const wish = await ok(db, ownerId, {
        priceType: "none",
        priceMin: "100",
        priceMax: "200",
        currency: "USD",
      });
      expect(wish.priceMin).toBeNull();
      expect(wish.priceMax).toBeNull();
      expect(wish.currency).toBeNull();
    });

    it("stores an image on our host as a ready CDN url", async () => {
      const wish = await ok(db, ownerId, { imageUrl: OURS });
      expect(wish.imageKey).toBe(OURS);
      expect(wish.imageStatus).toBe("ready");
    });

    it("keeps a valid category and blanks empty optional text", async () => {
      const wish = await ok(db, ownerId, {
        category: "home",
        notes: "   ",
        description: "",
        url: " https://shop.example/vase ",
      });
      expect(wish.category).toBe("home");
      expect(wish.notes).toBeNull();
      expect(wish.description).toBeNull();
      expect(wish.url).toBe("https://shop.example/vase");
    });
  });

  describe("updateWish", () => {
    it("patches only what it is given", async () => {
      const wish = await ok(db, ownerId, {
        title: "Headphones",
        category: "electronics",
        priceType: "exact",
        priceMin: "300",
        currency: "USD",
      });

      const result = await updateWish(db, ownerId, wish.id, {
        title: "Headphones, over-ear",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.wish.title).toBe("Headphones, over-ear");
      expect(result.wish.category).toBe("electronics");
      expect(result.wish.priceMin).toBe("300.00");
      expect(result.wish.currency).toBe("USD");
    });

    it("validates the patch against the stored row, not in isolation", async () => {
      const wish = await ok(db, ownerId, {
        priceType: "exact",
        priceMin: "300",
        currency: "USD",
      });

      // No amount in the patch — the stored 300 has to satisfy `exact`.
      const kept = await updateWish(db, ownerId, wish.id, {
        priceType: "exact",
      });
      expect(kept.ok).toBe(true);

      // Switching to a range with no upper bound anywhere is still invalid.
      const broken = await updateWish(db, ownerId, wish.id, {
        priceType: "range",
      });
      expect(broken).toEqual({ ok: false, error: "price" });
    });

    it("clears the image back to imageStatus none", async () => {
      const wish = await ok(db, ownerId, { imageUrl: OURS });
      const result = await updateWish(db, ownerId, wish.id, {
        imageUrl: null,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.wish.imageKey).toBeNull();
      expect(result.wish.imageStatus).toBe("none");
    });

    it("refuses to swap in a foreign image", async () => {
      const wish = await ok(db, ownerId, { imageUrl: OURS });
      const result = await updateWish(db, ownerId, wish.id, {
        imageUrl: FOREIGN,
      });
      expect(result).toEqual({ ok: false, error: "image" });

      const stored = await getOwnerWish(db, ownerId, wish.id);
      expect(stored?.imageKey).toBe(OURS);
    });

    /**
     * `image_status` belongs to the generation job (`wish-image.ts`), and the
     * edit form always resends `imageUrl: wish.imageKey` — null while a job is
     * running. An edit that does not really change the picture must therefore
     * touch neither column, or it silently cancels the job (whose terminal
     * write then no-ops and the drawn picture is discarded) or erases the
     * retry affordance of a failed one.
     */
    describe("image status is job state, not a form field", () => {
      /** Puts a wish into a status only the job state machine can produce. */
      async function park(
        wishId: string,
        imageStatus: "generating" | "failed",
        imageKey: string | null = null,
      ): Promise<void> {
        await db
          .update(wishes)
          .set({ imageStatus, imageKey })
          .where(eq(wishes.id, wishId));
      }

      it("leaves a running job alone on a title-only edit", async () => {
        const wish = await ok(db, ownerId, { title: "Ваза" });
        await park(wish.id, "generating");

        const result = await updateWish(db, ownerId, wish.id, {
          title: "Ваза, матовая",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wish.title).toBe("Ваза, матовая");
        expect(result.wish.imageStatus).toBe("generating");

        // And the job that is still drawing can finish onto this very row.
        expect(await finishImageGeneration(db, wish.id, OURS)).toBe(true);
        const stored = await getOwnerWish(db, ownerId, wish.id);
        expect(stored?.imageStatus).toBe("ready");
        expect(stored?.imageKey).toBe(OURS);
      });

      it("keeps the failed state, so the card still offers retry", async () => {
        const wish = await ok(db, ownerId);
        await park(wish.id, "failed");

        const result = await updateWish(db, ownerId, wish.id, {
          notes: "самый нужный",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wish.imageStatus).toBe("failed");
      });

      it("treats a resent (or whitespace-padded) stored image as untouched", async () => {
        const wish = await ok(db, ownerId, { imageUrl: OURS });
        await park(wish.id, "failed", OURS);

        // Exactly what the edit form submits: the image it was handed.
        const same = await updateWish(db, ownerId, wish.id, {
          title: "Та же ваза",
          imageUrl: OURS,
        });
        expect(same.ok).toBe(true);
        if (!same.ok) return;
        expect(same.wish.imageStatus).toBe("failed");
        expect(same.wish.imageKey).toBe(OURS);

        const padded = await updateWish(db, ownerId, wish.id, {
          imageUrl: `  ${OURS}  `,
        });
        expect(padded.ok).toBe(true);
        if (!padded.ok) return;
        expect(padded.wish.imageStatus).toBe("failed");
      });

      it("a genuinely new picture wins, and the late job is discarded", async () => {
        const wish = await ok(db, ownerId);
        await park(wish.id, "generating");

        const uploaded = await updateWish(db, ownerId, wish.id, {
          imageUrl: OURS_TOO,
        });
        expect(uploaded.ok).toBe(true);
        if (!uploaded.ok) return;
        expect(uploaded.wish.imageKey).toBe(OURS_TOO);
        expect(uploaded.wish.imageStatus).toBe("ready");

        // The clobber guard: the owner's upload is the newer intent.
        expect(await finishImageGeneration(db, wish.id, OURS)).toBe(false);
        const stored = await getOwnerWish(db, ownerId, wish.id);
        expect(stored?.imageKey).toBe(OURS_TOO);
        expect(stored?.imageStatus).toBe("ready");
      });

      it("clearing the picture still lands on none", async () => {
        const wish = await ok(db, ownerId, { imageUrl: OURS });
        await park(wish.id, "generating", OURS);

        const result = await updateWish(db, ownerId, wish.id, {
          imageUrl: null,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.wish.imageKey).toBeNull();
        expect(result.wish.imageStatus).toBe("none");
      });
    });

    it("reports a malformed or unknown id as not_found", async () => {
      expect(await updateWish(db, ownerId, "nope", { title: "x" })).toEqual({
        ok: false,
        error: "not_found",
      });
      expect(
        await updateWish(db, ownerId, MISSING_UUID, { title: "x" }),
      ).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("owner scoping", () => {
    it("hides another owner's wish behind every write", async () => {
      const wish = await ok(db, ownerId, { title: "Not yours" });

      expect(
        await updateWish(db, strangerId, wish.id, { title: "Mine" }),
      ).toEqual({ ok: false, error: "not_found" });
      expect(await deleteWish(db, strangerId, wish.id)).toBe(false);
      expect(await markGifted(db, strangerId, wish.id, "Me")).toBeNull();
      expect(await restoreWish(db, strangerId, wish.id)).toBeNull();

      const stored = await getOwnerWish(db, ownerId, wish.id);
      expect(stored?.title).toBe("Not yours");
      expect(stored?.status).toBe("active");
    });

    it("never writes a wish under the caller's id when the owner differs", async () => {
      const wish = await ok(db, ownerId);
      expect(await getOwnerWishes(db, strangerId)).toEqual([]);
      expect(await getOwnerWish(db, strangerId, wish.id)).toBeNull();
    });

    it("rejects malformed ids without touching the database", async () => {
      expect(await deleteWish(db, ownerId, "not-a-uuid")).toBe(false);
      expect(await markGifted(db, ownerId, "not-a-uuid", null)).toBeNull();
      expect(await restoreWish(db, ownerId, "not-a-uuid")).toBeNull();
    });
  });

  describe("gifted round-trip", () => {
    it("archives with free text and restores back to active", async () => {
      const wish = await ok(db, ownerId, { title: "Espresso machine" });

      const gifted = await markGifted(db, ownerId, wish.id, "  Mom  ");
      expect(gifted?.status).toBe("gifted");
      expect(gifted?.giftedBy).toBe("Mom");
      expect(gifted?.giftedAt).toBeInstanceOf(Date);

      // Gone from the live list, present in the archive.
      const active = await getOwnerWishes(db, ownerId);
      expect(active.map((w) => w.id)).not.toContain(wish.id);
      const archived = await getOwnerWishes(db, ownerId, { status: "gifted" });
      expect(archived.map((w) => w.id)).toContain(wish.id);

      const restored = await restoreWish(db, ownerId, wish.id);
      expect(restored?.status).toBe("active");
      expect(restored?.giftedAt).toBeNull();
      expect(restored?.giftedBy).toBeNull();
    });

    it("treats blank giver text as no giver", async () => {
      const wish = await ok(db, ownerId);
      const gifted = await markGifted(db, ownerId, wish.id, "   ");
      expect(gifted?.giftedBy).toBeNull();
    });

    it("returns null for an unknown id", async () => {
      expect(await markGifted(db, ownerId, MISSING_UUID, "Mom")).toBeNull();
      expect(await restoreWish(db, ownerId, MISSING_UUID)).toBeNull();
    });
  });

  describe("deleteWish", () => {
    it("removes the wish once and then reports nothing to delete", async () => {
      const wish = await ok(db, ownerId, { title: "Temporary" });
      expect(await deleteWish(db, ownerId, wish.id)).toBe(true);
      expect(await getOwnerWish(db, ownerId, wish.id)).toBeNull();
      expect(await deleteWish(db, ownerId, wish.id)).toBe(false);
    });
  });

  it("never mentions the booking table in its source", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/db/access/mutations.ts"),
      "utf8",
    );
    expect(source).not.toContain("reservations");
  });
});
