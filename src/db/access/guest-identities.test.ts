// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "../index";
import { guestIdentities, reservations } from "../schema";
import {
  createGuest,
  createReservation,
  createTestDb,
  createUser,
  createWish,
  type TestDb,
} from "../test-support";
import {
  countActiveGuestReservations,
  createGuestIdentity,
  findGuestByToken,
  isValidGuestEmail,
  mergeGuestIntoUser,
  setGuestEmail,
} from "./guest-identities";
import { reserveWish } from "./reservations";

describe("guest identities", () => {
  let ctx: TestDb;
  let db: Db;
  let ownerId: string;
  let friendId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    ownerId = await createUser(db);
    friendId = await createUser(db);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("createGuestIdentity", () => {
    it("creates a guest with an unguessable token", async () => {
      const result = await createGuestIdentity(db, { name: "  Маша  " });
      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [row] = await db
        .select()
        .from(guestIdentities)
        .where(eq(guestIdentities.id, result.id));
      expect(row.name).toBe("Маша");
      expect(row.email).toBeNull();
    });

    it("issues a different token every time", async () => {
      const first = await createGuestIdentity(db, { name: "A" });
      const second = await createGuestIdentity(db, { name: "B" });
      expect("error" in first || "error" in second).toBe(false);
      if ("error" in first || "error" in second) return;
      expect(first.token).not.toBe(second.token);
    });

    it("stores a trimmed email when one is given", async () => {
      const result = await createGuestIdentity(db, {
        name: "With mail",
        email: "  friend@example.test ",
      });
      expect("error" in result).toBe(false);
      if ("error" in result) return;

      const [row] = await db
        .select()
        .from(guestIdentities)
        .where(eq(guestIdentities.id, result.id));
      expect(row.email).toBe("friend@example.test");
    });

    it("rejects an empty or overlong name", async () => {
      expect(await createGuestIdentity(db, { name: "   " })).toEqual({
        error: "invalid_name",
      });
      expect(await createGuestIdentity(db, { name: "x".repeat(101) })).toEqual({
        error: "invalid_name",
      });
    });

    it("rejects a malformed email but treats a blank one as absent", async () => {
      for (const email of ["nope", "a@b", "two @example.test", "a@b.c"]) {
        expect(
          await createGuestIdentity(db, { name: "Bad mail", email }),
        ).toEqual({ error: "invalid_email" });
      }
      expect(
        await createGuestIdentity(db, { name: "Blank mail", email: "   " }),
      ).not.toHaveProperty("error");
    });

    it("agrees with the exported validator", () => {
      expect(isValidGuestEmail("friend@example.test")).toBe(true);
      expect(isValidGuestEmail("nope")).toBe(false);
      expect(isValidGuestEmail(`${"a".repeat(250)}@example.test`)).toBe(false);
    });
  });

  describe("findGuestByToken", () => {
    it("resolves a known token", async () => {
      const created = await createGuestIdentity(db, {
        name: "Findable",
        email: "findable@example.test",
      });
      if ("error" in created) throw new Error("setup failed");

      expect(await findGuestByToken(db, created.token)).toEqual({
        id: created.id,
        name: "Findable",
        email: "findable@example.test",
      });
    });

    it("returns null for empty, unknown and absurd tokens", async () => {
      expect(await findGuestByToken(db, "")).toBeNull();
      expect(await findGuestByToken(db, "x".repeat(201))).toBeNull();
      expect(await findGuestByToken(db, "not-a-real-token")).toBeNull();
    });
  });

  describe("setGuestEmail", () => {
    it("fills in an address the guest skipped", async () => {
      const guestId = await createGuest(db, "set-email-token");
      expect(await setGuestEmail(db, guestId, " later@example.test ")).toBe(
        true,
      );

      const [row] = await db
        .select()
        .from(guestIdentities)
        .where(eq(guestIdentities.id, guestId));
      expect(row.email).toBe("later@example.test");
    });

    it("refuses a bad address, a bad id and an unknown guest", async () => {
      const guestId = await createGuest(db, "reject-email-token");
      expect(await setGuestEmail(db, guestId, "nope")).toBe(false);
      expect(await setGuestEmail(db, "not-a-uuid", "a@example.test")).toBe(
        false,
      );
      expect(
        await setGuestEmail(
          db,
          "00000000-0000-4000-8000-000000000000",
          "a@example.test",
        ),
      ).toBe(false);
    });
  });

  describe("mergeGuestIntoUser", () => {
    it("moves live bookings onto the account and is idempotent", async () => {
      const guestId = await createGuest(db, "merge-token");
      const liveWish = await createWish(db, { ownerId, title: "Live" });
      await reserveWish(db, liveWish, { guestId });
      const orphanedId = await createReservation(db, {
        wishId: null,
        listOwnerId: ownerId,
        wishTitle: "Vanished",
        guestId,
        state: "orphaned",
        orphanedAt: new Date(),
      });
      // Cancelled history stays with the guest — nothing to carry over.
      const cancelledId = await createReservation(db, {
        wishId: null,
        listOwnerId: ownerId,
        wishTitle: "Dropped",
        guestId,
        state: "cancelled",
        cancelledAt: new Date(),
      });

      expect(await countActiveGuestReservations(db, guestId)).toBe(2);
      expect(await mergeGuestIntoUser(db, guestId, friendId)).toBe(2);

      const rows = await db
        .select()
        .from(reservations)
        .where(eq(reservations.listOwnerId, ownerId));
      const moved = rows.filter((r) => r.reserverUserId === friendId);
      expect(moved).toHaveLength(2);
      for (const row of moved) expect(row.guestId).toBeNull();
      expect(rows.find((r) => r.id === orphanedId)?.state).toBe("orphaned");
      expect(rows.find((r) => r.id === cancelledId)?.guestId).toBe(guestId);

      expect(await mergeGuestIntoUser(db, guestId, friendId)).toBe(0);
      expect(await countActiveGuestReservations(db, guestId)).toBe(0);
    });

    it("cancels a booking the guest made on the user's own list", async () => {
      const guestId = await createGuest(db, "own-list-token");
      const ownWish = await createWish(db, { ownerId, title: "My own thing" });
      const otherWish = await createWish(db, {
        ownerId: friendId,
        title: "Someone else's",
      });
      await reserveWish(db, ownWish, { guestId });
      await reserveWish(db, otherWish, { guestId });

      // The guest turns out to be the owner of the first list.
      expect(await mergeGuestIntoUser(db, guestId, ownerId)).toBe(1);

      const rows = await db
        .select()
        .from(reservations)
        .where(eq(reservations.guestId, guestId));
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("cancelled");
      expect(rows[0].cancelledAt).toBeInstanceOf(Date);
      // …and the slot on their own wish is free, so nobody inherited it.
      expect(
        await reserveWish(db, ownWish, { userId: friendId }),
      ).toMatchObject({ ok: true });
    });

    it("ignores a malformed guest id or an empty user id", async () => {
      const guestId = await createGuest(db, "guard-token");
      expect(await mergeGuestIntoUser(db, "not-a-uuid", friendId)).toBe(0);
      expect(await mergeGuestIntoUser(db, guestId, "")).toBe(0);
      expect(await countActiveGuestReservations(db, "not-a-uuid")).toBe(0);
    });
  });
});
