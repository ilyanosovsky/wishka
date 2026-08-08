import { randomBytes } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "../index";
import { guestIdentities, reservations } from "../schema";
import { isUuid } from "./ids";

/**
 * Friends who reserve without an account.
 *
 * The identity is a bearer token: whoever holds it manages that guest's
 * bookings. It lives in an httpOnly cookie and in manage-booking email links,
 * never in a page payload, so it is generated with `randomBytes` and stored
 * as the row's only credential.
 *
 * Guests are deliberately thin — a display name and an optional email. There is
 * no password, no verification, nothing to recover: losing the cookie without
 * an email on file simply loses the ability to manage the booking.
 */

/** Enough entropy that the token is not guessable; base64url is cookie-safe. */
const TOKEN_BYTES = 32;

const NAME_MAX = 100;
/** RFC 5321's cap on an address; also what the `email` column is sized for. */
const EMAIL_MAX = 254;
/**
 * Deliberately loose: the address is only ever used to *send* to, and the real
 * verdict comes from the mail provider. Its job is rejecting obvious junk and
 * anything with whitespace that could smuggle a header into an email.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type CreateGuestResult =
  { id: string; token: string } | { error: "invalid_name" | "invalid_email" };

function normalizeEmail(value: string): string | null {
  const email = value.trim();
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Exported so the server actions can reject an address before touching the DB. */
export function isValidGuestEmail(value: string): boolean {
  return normalizeEmail(value) !== null;
}

export async function createGuestIdentity(
  db: Db,
  input: { name: string; email?: string | null },
): Promise<CreateGuestResult> {
  const name = input.name.trim();
  if (!name || name.length > NAME_MAX) return { error: "invalid_name" };

  let email: string | null = null;
  const rawEmail = input.email?.trim() ?? "";
  if (rawEmail) {
    email = normalizeEmail(rawEmail);
    if (email === null) return { error: "invalid_email" };
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const [row] = await db
    .insert(guestIdentities)
    .values({ token, name, email })
    .returning({ id: guestIdentities.id });
  return { id: row.id, token };
}

/** Tokens we issue are 43 characters; anything far longer is not one of ours. */
const TOKEN_MAX = 200;

export async function findGuestByToken(
  db: Db,
  token: string,
): Promise<{ id: string; name: string; email: string | null } | null> {
  // A cookie or link parameter is attacker-controlled: refuse the absurd cases
  // before they reach the database at all.
  if (!token || token.length > TOKEN_MAX) return null;

  const [row] = await db
    .select({
      id: guestIdentities.id,
      name: guestIdentities.name,
      email: guestIdentities.email,
    })
    .from(guestIdentities)
    .where(eq(guestIdentities.token, token))
    .limit(1);
  return row ?? null;
}

/** Fills in the address a guest skipped on the booking form. */
export async function setGuestEmail(
  db: Db,
  guestId: string,
  email: string,
): Promise<boolean> {
  if (!isUuid(guestId)) return false;
  const normalized = normalizeEmail(email);
  if (normalized === null) return false;

  const updated = await db
    .update(guestIdentities)
    .set({ email: normalized })
    .where(eq(guestIdentities.id, guestId))
    .returning({ id: guestIdentities.id });
  return updated.length > 0;
}

/** What the merge prompt counts: bookings still worth carrying over. */
const LIVE_STATES = ["active", "orphaned"] as const;

export async function countActiveGuestReservations(
  db: Db,
  guestId: string,
): Promise<number> {
  if (!isUuid(guestId)) return 0;
  const rows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.guestId, guestId),
        inArray(reservations.state, [...LIVE_STATES]),
      ),
    );
  return rows.length;
}

/**
 * "Это ваши брони?" — moves a guest's bookings onto the account that just
 * signed in on the same device.
 *
 * One case cannot be moved: a booking the guest made on a wish from *this
 * user's own list*. `reserveWish` forbids an owner holding their own wish, and
 * transferring would both break that rule and hand the owner a reservation row
 * of their own — the surprise invariant in reverse. Those are cancelled.
 *
 * No unique-index conflict is possible on transfer: the partial index allows a
 * single `active` row per wish, so if the guest holds one, the user cannot.
 *
 * Idempotent — a second run finds nothing left in a live state and returns 0.
 */
export async function mergeGuestIntoUser(
  db: Db,
  guestId: string,
  userId: string,
): Promise<number> {
  if (!isUuid(guestId) || !userId) return 0;

  return db.transaction(async (tx) => {
    await tx
      .update(reservations)
      .set({ state: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(reservations.guestId, guestId),
          eq(reservations.listOwnerId, userId),
          inArray(reservations.state, [...LIVE_STATES]),
        ),
      );

    const moved = await tx
      .update(reservations)
      .set({ reserverUserId: userId, guestId: null })
      .where(
        and(
          eq(reservations.guestId, guestId),
          inArray(reservations.state, [...LIVE_STATES]),
        ),
      )
      .returning({ id: reservations.id });
    return moved.length;
  });
}
