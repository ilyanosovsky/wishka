import { and, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "../index";
import { groupMembers, profiles } from "../schema";
import { isUniqueViolation } from "./errors";
import { NICKNAME_RE } from "@/lib/nickname";

export type Profile = typeof profiles.$inferSelect;

/**
 * Someone claimed the nickname between the availability check and the write.
 * Callers should re-render the form with the field marked as taken.
 */
export class NicknameTakenError extends Error {
  readonly nickname: string;

  constructor(nickname: string) {
    super(`Nickname already taken: ${nickname}`);
    this.name = "NicknameTakenError";
    this.nickname = nickname;
  }
}

export type ProfileInput = {
  userId: string;
  nickname: string;
  baseCurrency?: string;
  partnerId?: string | null;
  sizes?: Record<string, string>;
  tastes?: string[];
  noGift?: string[];
};

/** Public URLs are `/u/<nickname>`, so nicknames are lowercase and url-safe.
 *  Single source: src/lib/nickname.ts (client-safe module). */
export const NICKNAME_PATTERN = NICKNAME_RE;

export function isValidNickname(nickname: string): boolean {
  return NICKNAME_PATTERN.test(nickname);
}

export async function getProfile(
  db: Db,
  userId: string,
): Promise<Profile | null> {
  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolves a public list URL (`/u/<nickname>`) back to its owner. The match is
 * case-insensitive, backed by the `lower(nickname)` unique index — the same
 * rule `isNicknameAvailable` enforces — so `/u/Ilya` and `/u/ilya` land on the
 * same profile.
 */
export async function getProfileByNickname(
  db: Db,
  nickname: string,
): Promise<Profile | null> {
  const rows = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.nickname}) = lower(${nickname})`)
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertProfile(
  db: Db,
  input: ProfileInput,
): Promise<Profile> {
  if (!isValidNickname(input.nickname)) {
    throw new Error(`Invalid nickname: ${input.nickname}`);
  }

  const values = {
    nickname: input.nickname,
    ...(input.baseCurrency !== undefined
      ? { baseCurrency: input.baseCurrency }
      : {}),
    ...(input.partnerId !== undefined ? { partnerId: input.partnerId } : {}),
    ...(input.sizes !== undefined ? { sizes: input.sizes } : {}),
    ...(input.tastes !== undefined ? { tastes: input.tastes } : {}),
    ...(input.noGift !== undefined ? { noGift: input.noGift } : {}),
  };

  try {
    const [row] = await db
      .insert(profiles)
      .values({ userId: input.userId, ...values })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return row;
  } catch (error) {
    // The row's own primary key is handled by ON CONFLICT, so the only unique
    // constraints left to break are the two on `nickname`.
    if (isUniqueViolation(error)) {
      throw new NicknameTakenError(input.nickname);
    }
    throw error;
  }
}

/**
 * Nicknames are compared case-insensitively (a `lower(nickname)` unique index
 * backs this up). An invalidly formatted nickname is never available.
 */
export async function isNicknameAvailable(
  db: Db,
  nickname: string,
  excludeUserId?: string,
): Promise<boolean> {
  if (!isValidNickname(nickname)) return false;

  const sameNickname = sql`lower(${profiles.nickname}) = lower(${nickname})`;
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(
      excludeUserId === undefined
        ? sameNickname
        : and(sameNickname, ne(profiles.userId, excludeUserId)),
    )
    .limit(1);
  return rows.length === 0;
}

export type SetPartnerError = "self" | "not_shared" | "not_found";

/**
 * §6.6 partner — pinned first in the who-can-see-it people picker (§6.3), never
 * a fourth visibility mode of its own.
 *
 * A partner is not a free-text claim: the only relationship Wishka can vouch
 * for is shared group membership, so `partnerId` must name someone who is
 * *currently* a co-member of at least one of `userId`'s groups. Partnering
 * yourself is refused outright — the picker's own candidate list should never
 * offer it, but the write path holds the line regardless of what the UI does.
 */
export async function setPartner(
  db: Db,
  userId: string,
  partnerId: string,
): Promise<{ ok: true } | { ok: false; error: SetPartnerError }> {
  if (partnerId === userId) return { ok: false, error: "self" };

  const ownGroups = alias(groupMembers, "own_groups");
  const partnerGroups = alias(groupMembers, "partner_groups");
  const shared = await db
    .select({ groupId: ownGroups.groupId })
    .from(ownGroups)
    .innerJoin(
      partnerGroups,
      and(
        eq(partnerGroups.groupId, ownGroups.groupId),
        eq(partnerGroups.userId, partnerId),
      ),
    )
    .where(eq(ownGroups.userId, userId))
    .limit(1);
  if (shared.length === 0) return { ok: false, error: "not_shared" };

  const updated = await db
    .update(profiles)
    .set({ partnerId, updatedAt: new Date() })
    .where(eq(profiles.userId, userId))
    .returning({ userId: profiles.userId });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

/** Every other profile column is untouched — a bare `partnerId` clear. */
export async function clearPartner(
  db: Db,
  userId: string,
): Promise<{ ok: boolean }> {
  const updated = await db
    .update(profiles)
    .set({ partnerId: null, updatedAt: new Date() })
    .where(eq(profiles.userId, userId))
    .returning({ userId: profiles.userId });
  return { ok: updated.length > 0 };
}
