"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { findGuestByToken } from "@/db/access/guest-identities";
import { getAuth } from "@/lib/auth";
import { setGuestCookie } from "@/lib/guest";
import { sanitizeNextPath } from "@/lib/next-param";

/**
 * Deliberate device switch from the /g/<token>/confirm screen: adopt the
 * token's guest identity, replacing whatever this device held. Only reachable
 * behind the confirmation the route redirects to when a *different* identity is
 * already present, so the swap is always a choice, never a silent side effect.
 */
export async function adoptGuestTokenAction(
  token: string,
  next: string,
): Promise<void> {
  const target = sanitizeNextPath(next);
  // Mirror the route handler: a signed-in visitor is never turned into a guest,
  // or `resolveGuestIdentity` would count that identity in the merge prompt.
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect(target);

  const guest = await findGuestByToken(getDb(), token);
  if (guest) await setGuestCookie(token);
  redirect(target);
}
