"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getProfile, upsertProfile } from "@/db/access/profiles";
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
