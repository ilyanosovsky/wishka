import { cookies } from "next/headers";

/**
 * The guest device identity: an httpOnly cookie carrying the raw
 * `guest_identities.token`. The token is the credential — anyone holding it
 * can manage that guest's reservations — so it never reaches client-side JS
 * and travels only in the cookie or in a manage-booking email link.
 */

export const GUEST_COOKIE = "wishka-guest";

/** Chrome caps cookie lifetime at 400 days; ask for exactly that. */
const GUEST_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** Shared with the /g/[token] route handler, which sets the cookie on a
 *  redirect response rather than through `cookies()`. */
export function guestCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  } as const;
}

export async function readGuestToken(): Promise<string | null> {
  const value = (await cookies()).get(GUEST_COOKIE)?.value;
  return value ? value : null;
}

export async function setGuestCookie(token: string): Promise<void> {
  (await cookies()).set(GUEST_COOKIE, token, guestCookieOptions());
}

export async function clearGuestCookie(): Promise<void> {
  (await cookies()).delete(GUEST_COOKIE);
}
