"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deleteAccount } from "@/db/access/account";
import { getDb } from "@/db";
import {
  clearPartner,
  getProfile,
  setPartner,
  upsertProfile,
  type SetPartnerError,
} from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";
import {
  sanitizePublicParams,
  type PublicParamsInput,
} from "./params-sanitize";

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user.id;
}

/**
 * §6.6 public parameters (sizes/tastes/no-gift). Nickname, base currency and
 * partner are untouched — they pass through unchanged so this action can
 * never clobber a field owned by a different part of the profile screen.
 */
export async function updatePublicParams(
  input: PublicParamsInput,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const db = getDb();

  const existing = await getProfile(db, userId);
  if (!existing) return { ok: false };

  const { sizes, tastes, noGift } = sanitizePublicParams(input);

  await upsertProfile(db, {
    userId,
    nickname: existing.nickname,
    baseCurrency: existing.baseCurrency,
    partnerId: existing.partnerId,
    sizes,
    tastes,
    noGift,
  });

  revalidatePath("/profile");
  revalidatePath(`/u/${existing.nickname}`);
  return { ok: true };
}

/** §6.6 partner block. Picking a partner is the whole action — there is no
 *  separate save step, so the sheet closes on a successful result. */
export async function setPartnerAction(
  partnerId: string,
): Promise<{ ok: true } | { ok: false; error: SetPartnerError }> {
  const userId = await requireUserId();
  const result = await setPartner(getDb(), userId, partnerId);
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function clearPartnerAction(): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const result = await clearPartner(getDb(), userId);
  if (result.ok) revalidatePath("/profile");
  return result;
}

/**
 * Bespoke, not Better Auth's `deleteUser` (unused in `src/lib/auth.ts`, and it
 * would only remove the session/account/user rows anyway — none of the group
 * succession this account's deletion has to run first).
 *
 * Redirects rather than returning a result: the caller has nothing left to
 * render for as soon as this resolves, and the stale session cookie already
 * points at a user row that is gone, so `getSession` on the next request
 * resolves to "no session" on its own — no explicit sign-out call needed.
 */
export async function deleteAccountAction(): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const result = await deleteAccount(getDb(), userId);
  if (!result.ok) return { ok: false };
  redirect("/");
}
