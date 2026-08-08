import "server-only";

import { headers } from "next/headers";

import type { Db } from "@/db";
import { findGuestByToken } from "@/db/access/guest-identities";
import type { Reserver, Viewer } from "@/db/access/types";
import { getAuth } from "@/lib/auth";
import { readGuestToken } from "@/lib/guest";

/**
 * One rule for "who is looking": a session wins over a guest cookie, a guest
 * cookie wins over nothing. Every viewer-facing page and reservation action
 * resolves identity here, so the precedence can never drift between surfaces.
 *
 * A user who booked as a guest and then signed in is deliberately *not* both:
 * their guest bookings show as plain "reserved" until they accept the merge
 * prompt — that is what makes the prompt worth showing.
 */

async function sessionUserId(): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

async function guestFromCookie(
  db: Db,
): Promise<{ id: string; name: string; email: string | null } | null> {
  const token = await readGuestToken();
  return token ? findGuestByToken(db, token) : null;
}

export async function resolveViewer(db: Db): Promise<Viewer> {
  const userId = await sessionUserId();
  if (userId) return { userId };
  const guest = await guestFromCookie(db);
  return guest ? { guestId: guest.id } : { anonymous: true };
}

export async function resolveReserver(db: Db): Promise<Reserver | null> {
  const userId = await sessionUserId();
  if (userId) return { userId };
  const guest = await guestFromCookie(db);
  return guest ? { guestId: guest.id } : null;
}

/** The guest identity behind the device cookie, if any — even alongside a
 *  session (that pairing is exactly what the merge prompt looks for). */
export async function resolveGuestIdentity(
  db: Db,
): Promise<{ id: string; name: string; email: string | null } | null> {
  return guestFromCookie(db);
}
