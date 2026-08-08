import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/db";
import { findGuestByToken } from "@/db/access/guest-identities";
import { GUEST_COOKIE, guestCookieOptions } from "@/lib/guest";
import { sanitizeNextPath } from "@/lib/next-param";

/**
 * The manage-booking link from a guest's email: `/g/<token>?next=/w/<id>`.
 * A valid token logs this device in as that guest (the cookie), then forwards
 * to the wish; an unknown token forwards without the cookie, so the visitor
 * simply sees the wish as an anonymous guest — the link never errors and never
 * confirms whether a token exists.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const next = sanitizeNextPath(req.nextUrl.searchParams.get("next"));

  const res = NextResponse.redirect(new URL(next, req.nextUrl.origin));
  const guest = await findGuestByToken(getDb(), token);
  if (guest) res.cookies.set(GUEST_COOKIE, token, guestCookieOptions());
  return res;
}
