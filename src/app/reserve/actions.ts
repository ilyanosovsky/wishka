"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { getLocale } from "next-intl/server";

import { getDb } from "@/db";
import {
  createGuestIdentity,
  findGuestByToken,
  isValidGuestEmail,
  mergeGuestIntoUser,
  setGuestEmail,
} from "@/db/access/guest-identities";
import {
  cancelReservation,
  dismissReservation,
  reserveWish,
} from "@/db/access/reservations";
import { getReservationNotificationTarget } from "@/db/access/wish-lifecycle";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getAuth } from "@/lib/auth";
import { sendGuestBookingConfirmation } from "@/lib/email/reservation-emails";
import { clearGuestCookie, readGuestToken, setGuestCookie } from "@/lib/guest";
import { resolveReserver } from "@/lib/viewer";

/**
 * The reserver-side half of the booking lifecycle. The owner-side half
 * (orphaning and change/delete/gifted emails) lives in the owner's own
 * actions — nothing here ever runs on behalf of a list owner, and
 * `reserveWish` itself turns an owner reserving their own wish into
 * `not_found`.
 *
 * Emails are dispatched inside `after()` exclusively: a booking must never
 * fail, slow down, or change shape because Resend did.
 */

async function requestLocale(): Promise<Locale> {
  const locale = await getLocale();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** `/g/<token>` logs the guest's device in, then forwards to the wish. */
function manageBookingUrl(token: string, wishId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/g/${token}?next=${encodeURIComponent(`/w/${wishId}`)}`;
}

/**
 * Sends the guest their confirmation once the dust settles. Reads the target
 * fresh inside `after()` so it only fires while that guest still holds the
 * active booking, and never leaks anything into the response.
 */
function queueGuestConfirmation(wishId: string): void {
  after(async () => {
    const target = await getReservationNotificationTarget(getDb(), wishId);
    if (target?.isGuest && target.email && target.guestToken) {
      await sendGuestBookingConfirmation({
        to: target.email,
        locale: target.locale,
        guestName: target.name,
        wishTitle: target.wishTitle,
        manageUrl: manageBookingUrl(target.guestToken, wishId),
      });
    }
  });
}

export type ReserveActionResult =
  | { ok: true }
  | { ok: false; reason: "already_reserved" | "not_found" | "need_guest" };

/** Reserve as whoever the request already identifies: session user or
 *  cookie'd guest. A truly anonymous caller is told to introduce themselves. */
export async function reserveWishAction(
  wishId: string,
): Promise<ReserveActionResult> {
  const db = getDb();
  const reserver = await resolveReserver(db);
  if (!reserver) return { ok: false, reason: "need_guest" };

  const result = await reserveWish(db, wishId, reserver, {
    locale: await requestLocale(),
  });
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export type GuestReserveResult =
  | { ok: true; hasEmail: boolean }
  | {
      ok: false;
      reason: "already_reserved" | "not_found" | "invalid_name" | "invalid_email";
    };

/** First-time guest booking: mint the device identity, then reserve with it. */
export async function reserveAsGuestAction(
  wishId: string,
  input: { name: string; email?: string | null },
): Promise<GuestReserveResult> {
  const db = getDb();
  const locale = await requestLocale();

  // The form is for the truly anonymous; if a session or guest cookie already
  // identifies the caller (a second tab, a stale sheet), reserve as them
  // instead of minting a duplicate identity.
  const existing = await resolveReserver(db);
  if (existing) {
    const result = await reserveWish(db, wishId, existing, { locale });
    if (!result.ok) return { ok: false, reason: result.reason };
    if ("guestId" in existing) queueGuestConfirmation(wishId);
    return { ok: true, hasEmail: true };
  }

  const created = await createGuestIdentity(db, input);
  if ("error" in created) return { ok: false, reason: created.error };
  // The device is remembered even if the reserve below loses a race — the
  // guest shouldn't have to introduce themselves twice.
  await setGuestCookie(created.token);

  const result = await reserveWish(db, wishId, { guestId: created.id }, { locale });
  if (!result.ok) return { ok: false, reason: result.reason };

  const hasEmail = Boolean(input.email?.trim());
  if (hasEmail) queueGuestConfirmation(wishId);
  return { ok: true, hasEmail };
}

export async function cancelReservationAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const db = getDb();
  const reserver = await resolveReserver(db);
  if (!reserver) return { ok: false };
  const result = await cancelReservation(db, wishId, reserver);
  return { ok: result.ok };
}

/** Cancel by reservation id — the "Мои брони" card, where the wish itself may
 *  already be gone. */
export async function dismissReservationAction(
  reservationId: string,
): Promise<{ ok: boolean }> {
  const db = getDb();
  const reserver = await resolveReserver(db);
  if (!reserver) return { ok: false };
  const result = await dismissReservation(db, reservationId, reserver);
  if (result.ok) revalidatePath("/people");
  return { ok: result.ok };
}

export type SaveGuestEmailResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" | "not_found" };

/** The post-booking "leave an email" prompt. Also (re)sends the confirmation,
 *  since the email is what carries the manage-booking link. */
export async function saveGuestEmailAction(
  wishId: string,
  email: string,
): Promise<SaveGuestEmailResult> {
  const db = getDb();
  const token = await readGuestToken();
  const guest = token ? await findGuestByToken(db, token) : null;
  if (!guest) return { ok: false, reason: "not_found" };
  if (!isValidGuestEmail(email)) return { ok: false, reason: "invalid_email" };

  const saved = await setGuestEmail(db, guest.id, email);
  if (!saved) return { ok: false, reason: "invalid_email" };

  queueGuestConfirmation(wishId);
  return { ok: true };
}

export type MergeResult = { ok: true; moved: number } | { ok: false };

/** "Нашли ваши брони — перенести в аккаунт?" → yes. Consumes the guest cookie
 *  either way: after a merge the device identity has served its purpose. */
export async function mergeGuestReservationsAction(): Promise<MergeResult> {
  const db = getDb();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return { ok: false };

  const token = await readGuestToken();
  const guest = token ? await findGuestByToken(db, token) : null;
  if (!guest) {
    // A stale or forged token identifies nobody; drop it so the prompt stops.
    if (token) await clearGuestCookie();
    return { ok: true, moved: 0 };
  }

  const moved = await mergeGuestIntoUser(db, guest.id, session.user.id);
  await clearGuestCookie();
  revalidatePath("/people");
  return { ok: true, moved };
}
