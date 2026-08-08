// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// viewer.ts is `import "server-only"`; neutralise the guard for the node env.
vi.mock("server-only", () => ({}));

// getAuth().api.getSession is the only session source, and readGuestToken is the
// only guest-cookie source; both are spies. findGuestByToken stays real (PGlite)
// so the precedence logic is exercised against actual rows, not a stubbed lookup.
const { getSession, readGuestToken } = vi.hoisted(() => ({
  getSession: vi.fn(),
  readGuestToken: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession } }),
}));
vi.mock("@/lib/guest", () => ({
  readGuestToken,
}));

// Only ever handed to the mocked getSession, so the value is irrelevant.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

import type { Db } from "@/db";
import { createGuest, createTestDb, type TestDb } from "@/db/test-support";
import { resolveGuestIdentity, resolveReserver, resolveViewer } from "./viewer";

const GUEST_TOKEN = "guest-token-viewer";

describe("viewer identity resolution", () => {
  let ctx: TestDb;
  let db: Db;
  let guestId: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    db = ctx.db;
    guestId = await createGuest(db, GUEST_TOKEN);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    getSession.mockReset();
    readGuestToken.mockReset();
  });

  const withSession = (userId: string) =>
    getSession.mockResolvedValue({ user: { id: userId } });
  const withoutSession = () => getSession.mockResolvedValue(null);
  const withCookie = (token: string | null) =>
    readGuestToken.mockResolvedValue(token);

  describe("resolveViewer", () => {
    it("returns { userId } when a session is present — even alongside a guest cookie", async () => {
      withSession("user-1");
      withCookie(GUEST_TOKEN); // a valid guest cookie is present too
      expect(await resolveViewer(db)).toEqual({ userId: "user-1" });
    });

    it("returns { guestId } for a valid guest cookie with no session", async () => {
      withoutSession();
      withCookie(GUEST_TOKEN);
      expect(await resolveViewer(db)).toEqual({ guestId });
    });

    it("returns { anonymous: true } with no session and no cookie", async () => {
      withoutSession();
      withCookie(null);
      expect(await resolveViewer(db)).toEqual({ anonymous: true });
    });

    it("returns { anonymous: true } when the cookie token matches no guest", async () => {
      withoutSession();
      withCookie("no-such-token");
      expect(await resolveViewer(db)).toEqual({ anonymous: true });
    });
  });

  describe("resolveReserver", () => {
    it("returns { userId } when a session is present — session wins over a guest cookie", async () => {
      withSession("user-1");
      withCookie(GUEST_TOKEN);
      expect(await resolveReserver(db)).toEqual({ userId: "user-1" });
    });

    it("returns { guestId } for a valid guest cookie with no session", async () => {
      withoutSession();
      withCookie(GUEST_TOKEN);
      expect(await resolveReserver(db)).toEqual({ guestId });
    });

    it("returns null with no session and no cookie", async () => {
      withoutSession();
      withCookie(null);
      expect(await resolveReserver(db)).toBeNull();
    });

    it("returns null when the cookie token matches no guest", async () => {
      withoutSession();
      withCookie("no-such-token");
      expect(await resolveReserver(db)).toBeNull();
    });
  });

  describe("resolveGuestIdentity", () => {
    it("returns the guest even while a session is present (the merge-prompt pairing)", async () => {
      withSession("user-1");
      withCookie(GUEST_TOKEN);
      expect(await resolveGuestIdentity(db)).toMatchObject({ id: guestId });
    });

    it("returns null when no guest cookie is present", async () => {
      withSession("user-1");
      withCookie(null);
      expect(await resolveGuestIdentity(db)).toBeNull();
    });
  });
});
