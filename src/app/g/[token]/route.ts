import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { findGuestByToken } from "@/db/access/guest-identities";
import { getAuth } from "@/lib/auth";
import { GUEST_COOKIE, guestCookieOptions, readGuestToken } from "@/lib/guest";
import { sanitizeNextPath } from "@/lib/next-param";

/**
 * The manage-booking link from a guest's email: `/g/<token>?next=/w/<id>`.
 *
 * The token is a bearer credential, so adopting it on a device is treated as a
 * deliberate act, never a silent side effect of following a link:
 *
 *  - A signed-in visitor is NOT turned back into a guest — the cookie is
 *    skipped and they land on `next`; the merge prompt reconciles any guest
 *    bookings with their account.
 *  - When the device already carries a *different* guest identity, we do not
 *    overwrite it (that would strand the current guest's bookings and enable
 *    fixation). The visitor is sent to a confirmation screen to switch.
 *  - Otherwise (no identity, or the same token) the cookie is set and we go.
 *
 * An unknown token forwards to `next` with no cookie: the link never errors and
 * never reveals whether a token exists.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const next = sanitizeNextPath(req.nextUrl.searchParams.get("next"));
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, req.nextUrl.origin));

  const guest = await findGuestByToken(getDb(), token);
  if (!guest) return redirectTo(next);

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) return redirectTo(next);

  const existing = await readGuestToken();
  if (existing && existing !== token) {
    // Don't clobber another identity — let the visitor choose to switch.
    const confirm = new URL(`/g/${token}/confirm`, req.nextUrl.origin);
    confirm.searchParams.set("next", next);
    return NextResponse.redirect(confirm);
  }

  const res = redirectTo(next);
  res.cookies.set(GUEST_COOKIE, token, guestCookieOptions());
  return res;
}
