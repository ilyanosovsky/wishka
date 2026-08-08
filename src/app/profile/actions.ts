"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deleteAccount } from "@/db/access/account";
import { getDb } from "@/db";
import {
  clearPartner,
  getProfile,
  isNicknameAvailable,
  NicknameTakenError,
  setPartner,
  upsertProfile,
  type SetPartnerError,
} from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";
import { isCurrencyCode } from "@/lib/currencies";
import { NICKNAME_RE } from "@/lib/nickname";
import type { NicknameCheck } from "@/app/welcome/actions";
import {
  sanitizePublicParams,
  type PublicParamsInput,
} from "./params-sanitize";

/** Same cap onboarding writes with (src/app/welcome/actions.ts). */
const NAME_MAX_LENGTH = 80;

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

/**
 * §6.6 name edit. `user.name` lives on Better Auth's table, not on `profiles`,
 * so this goes through `updateUser` exactly like onboarding does — the two
 * write paths must not diverge.
 */
export async function updateNameAction(name: string): Promise<{ ok: boolean }> {
  await requireUserId();
  const trimmed = name.trim().slice(0, NAME_MAX_LENGTH);
  if (!trimmed) return { ok: false };

  try {
    await getAuth().api.updateUser({
      body: { name: trimmed },
      headers: await headers(),
    });
  } catch {
    return { ok: false };
  }

  revalidatePath("/profile");
  return { ok: true };
}

/** §6.6 nickname change — the live availability check behind the sheet.
 *  Mirrors `checkNickname` in src/app/welcome/actions.ts. */
export async function checkNicknameAction(
  nickname: string,
): Promise<NicknameCheck> {
  const userId = await requireUserId();
  const value = nickname.trim().toLowerCase();
  if (!NICKNAME_RE.test(value)) return "invalid";
  return (await isNicknameAvailable(getDb(), value, userId)) ? "free" : "taken";
}

/**
 * §6.6 nickname change. Only `nickname` is passed to `upsertProfile`, so the
 * generated SET list touches nothing else — sizes/tastes/no-gift/partner/base
 * currency all survive a rename untouched.
 *
 * The old public path is revalidated alongside the new one: `/u/<old>` must
 * stop resolving from cache the moment the link stops working
 * («Старая ссылка перестанет работать»).
 */
export async function updateNicknameAction(
  nickname: string,
): Promise<{ ok: true } | { ok: false; error: "invalid" | "taken" }> {
  const userId = await requireUserId();
  const db = getDb();

  const value = nickname.trim().toLowerCase();
  if (!NICKNAME_RE.test(value)) return { ok: false, error: "invalid" };

  const existing = await getProfile(db, userId);
  if (!existing) return { ok: false, error: "invalid" };
  if (existing.nickname === value) return { ok: true };

  try {
    await upsertProfile(db, { userId, nickname: value });
  } catch (error) {
    // Check-then-write race on the nickname unique index.
    if (error instanceof NicknameTakenError)
      return { ok: false, error: "taken" };
    throw error;
  }

  revalidatePath("/profile");
  revalidatePath(`/u/${existing.nickname}`);
  revalidatePath(`/u/${value}`);
  return { ok: true };
}

/** §6.6 base currency. Same single-column discipline as the nickname write. */
export async function updateBaseCurrencyAction(
  code: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  if (!isCurrencyCode(code)) return { ok: false };

  const db = getDb();
  const existing = await getProfile(db, userId);
  if (!existing) return { ok: false };

  await upsertProfile(db, {
    userId,
    nickname: existing.nickname,
    baseCurrency: code,
  });

  revalidatePath("/profile");
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
 *
 * Hence the narrowed return type: this resolves *only* on failure, and saying
 * so keeps a caller from reading `.ok` off a value that never arrives.
 */
export async function deleteAccountAction(): Promise<{ ok: false } | never> {
  const userId = await requireUserId();
  const result = await deleteAccount(getDb(), userId);
  if (!result.ok) return { ok: false };
  redirect("/");
}
