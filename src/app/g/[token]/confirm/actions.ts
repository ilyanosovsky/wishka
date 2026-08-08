"use server";

import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { findGuestByToken } from "@/db/access/guest-identities";
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
  const guest = await findGuestByToken(getDb(), token);
  if (guest) await setGuestCookie(token);
  redirect(target);
}
