import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Db } from "../index";
import {
  groupMembers,
  groups,
  profiles,
  user,
  wishVisibility,
  wishes,
} from "../schema";
import { isUuid } from "./ids";
import { createWish } from "./mutations";
import type {
  WishInput,
  WishMutationResult,
  WishValidationError,
} from "./mutations";
import type { OwnerWish, Viewer, WishVisibility } from "./types";
import { visibleTo } from "./viewer";

/**
 * The write side of item-level visibility (invariant #2) — the audience a
 * wish is addressed to.
 *
 * `visibleTo` in `viewer.ts` is the read side and the only place the rule is
 * evaluated; this module is the only place it is *set*. No component decides
 * who sees what, and no caller writes `wish_visibility` directly.
 *
 * VALIDATION IS SERVER-SIDE AND TOTAL. The picker's candidate list is a
 * suggestion, not a guarantee: a hand-crafted payload must not be able to
 * address a wish to a group the owner is not in, or to a person they have no
 * relationship with — such a row would hand a stranger a permanent key to one
 * of the owner's wishes. Every subject is re-derived here from membership and
 * the partner link.
 *
 * A `restricted` audience with no subjects is refused rather than stored: it
 * would silently hide the wish from everybody, which is never what the owner
 * meant by picking «отдельным людям» and forgetting to tick a name.
 */

export type WishAudience = {
  mode: WishVisibility;
  /** uuids */
  groupIds: string[];
  /** user ids */
  userIds: string[];
};

export type AudienceCandidates = {
  groups: {
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
  }[];
  /** Members of the owner's groups, deduped. The partner sorts first (§6.3). */
  people: {
    userId: string;
    name: string;
    image: string | null;
    isPartner: boolean;
  }[];
};

export type AudienceError = "not_found" | "empty_audience" | "invalid_subject";

export type SetAudienceResult =
  { ok: true } | { ok: false; error: AudienceError };

/** A wish write that also carries an audience — the wish errors plus the
 *  audience ones, so one result covers the whole save. */
export type WishWithAudienceResult =
  | { ok: true; wish: OwnerWish }
  | { ok: false; error: WishValidationError | "not_found" | AudienceError };

/**
 * Thrown to unwind a transaction whose wish write already landed but whose
 * audience was refused, so a rejected audience never leaves a half-saved wish
 * behind. Caught by `createWishWithAudience` and `updateWishAsOwner`; it never
 * escapes them.
 */
export class AudienceRejected extends Error {
  readonly error: AudienceError;

  constructor(error: AudienceError) {
    super(`audience rejected: ${error}`);
    this.name = "AudienceRejected";
    this.error = error;
  }
}

/** Null when the value is not a list of ids at all — a malformed payload is
 *  refused, not silently trimmed down to whatever parsed. */
function normalizeIds(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  if (!values.every((value) => typeof value === "string")) return null;
  return [...new Set(values as string[])];
}

function comparePeople(
  a: AudienceCandidates["people"][number],
  b: AudienceCandidates["people"][number],
): number {
  if (a.isPartner !== b.isPartner) return a.isPartner ? -1 : 1;
  return a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
}

async function partnerIdOf(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ partnerId: profiles.partnerId })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return row?.partnerId ?? null;
}

/**
 * Everyone the owner may address a wish to: the groups they belong to, and the
 * people they share one with. The partner is in the list even with no group in
 * common — being someone's partner is itself the relationship the wish is
 * addressed to — and sorts first, which is the whole of §6.3's "pinned".
 */
export async function getAudienceCandidates(
  db: Db,
  ownerId: string,
): Promise<AudienceCandidates> {
  const ownGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      emoji: groups.emoji,
      color: groups.color,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, ownerId))
    .orderBy(desc(groups.createdAt), desc(groups.id));

  const partnerId = await partnerIdOf(db, ownerId);

  const mate = alias(groupMembers, "gm_mate");
  const mates = await db
    .selectDistinct({
      userId: user.id,
      name: user.name,
      image: user.image,
    })
    .from(groupMembers)
    .innerJoin(mate, eq(mate.groupId, groupMembers.groupId))
    .innerJoin(user, eq(user.id, mate.userId))
    .where(and(eq(groupMembers.userId, ownerId), ne(mate.userId, ownerId)));

  const people = new Map<string, AudienceCandidates["people"][number]>();
  for (const person of mates) {
    people.set(person.userId, {
      ...person,
      isPartner: person.userId === partnerId,
    });
  }

  if (partnerId !== null && partnerId !== ownerId && !people.has(partnerId)) {
    const [partner] = await db
      .select({ userId: user.id, name: user.name, image: user.image })
      .from(user)
      .where(eq(user.id, partnerId))
      .limit(1);
    if (partner) people.set(partnerId, { ...partner, isPartner: true });
  }

  return {
    groups: ownGroups,
    people: [...people.values()].sort(comparePeople),
  };
}

/**
 * The audience of one of the owner's own wishes, for the edit form. A wish that
 * is not theirs comes back null — indistinguishable from a missing one, so an
 * id is never an existence oracle.
 */
export async function getWishAudience(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<WishAudience | null> {
  if (!isUuid(wishId)) return null;

  const [wish] = await db
    .select({ visibility: wishes.visibility })
    .from(wishes)
    .where(and(eq(wishes.id, wishId), eq(wishes.ownerId, ownerId)))
    .limit(1);
  if (!wish) return null;

  const rows = await db
    .select({
      subjectType: wishVisibility.subjectType,
      subjectId: wishVisibility.subjectId,
    })
    .from(wishVisibility)
    .where(eq(wishVisibility.wishId, wishId));

  return {
    mode: wish.visibility,
    groupIds: rows
      .filter((row) => row.subjectType === "group")
      .map((row) => row.subjectId),
    userIds: rows
      .filter((row) => row.subjectType === "user")
      .map((row) => row.subjectId),
  };
}

/**
 * Every subject re-derived from the database: a group must be one the owner is
 * a member of, a person must be a member of one of those groups or the owner's
 * partner. The owner themselves is refused — the picker never offers them, and
 * an audience of just the owner is the "accidentally hidden from everybody"
 * case `empty_audience` exists to prevent, wearing a subject.
 */
async function subjectsAreAddressable(
  tx: Db,
  ownerId: string,
  groupIds: string[],
  userIds: string[],
): Promise<boolean> {
  if (groupIds.some((id) => !isUuid(id))) return false;
  if (userIds.includes(ownerId)) return false;

  if (groupIds.length > 0) {
    const rows = await tx
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, ownerId),
          inArray(groupMembers.groupId, groupIds),
        ),
      );
    if (rows.length !== groupIds.length) return false;
  }

  if (userIds.length > 0) {
    const mate = alias(groupMembers, "gm_mate");
    const rows = await tx
      .selectDistinct({ userId: mate.userId })
      .from(groupMembers)
      .innerJoin(mate, eq(mate.groupId, groupMembers.groupId))
      .where(
        and(eq(groupMembers.userId, ownerId), inArray(mate.userId, userIds)),
      );

    const addressable = new Set(rows.map((row) => row.userId));
    const partnerId = await partnerIdOf(tx, ownerId);
    if (partnerId !== null) addressable.add(partnerId);
    if (!userIds.every((id) => addressable.has(id))) return false;
  }

  return true;
}

/**
 * Replaces a wish's audience wholesale. Takes a transaction handle: the wish
 * write and its audience have to land or fail together, or an owner could end
 * up with an edit saved under the old audience.
 *
 * `updatedAt` is deliberately not bumped here — the wish form's own write owns
 * that column, and on creation a bump would make the returned DTO stale.
 */
export async function setWishAudience(
  tx: Db,
  ownerId: string,
  wishId: string,
  audience: WishAudience,
): Promise<SetAudienceResult> {
  if (!isUuid(wishId)) return { ok: false, error: "not_found" };
  // A hand-crafted payload is not typed. An audience that is not an object at
  // all is refused like any other malformed value — never dereferenced, the
  // same rule `normalizeIds` applies to the subject lists.
  if (typeof audience !== "object" || audience === null) {
    return { ok: false, error: "invalid_subject" };
  }
  if (audience.mode !== "everyone" && audience.mode !== "restricted") {
    return { ok: false, error: "invalid_subject" };
  }

  const [wish] = await tx
    .select({ id: wishes.id })
    .from(wishes)
    .where(and(eq(wishes.id, wishId), eq(wishes.ownerId, ownerId)))
    .limit(1);
  if (!wish) return { ok: false, error: "not_found" };

  let groupIds: string[] = [];
  let userIds: string[] = [];

  if (audience.mode === "restricted") {
    const normalizedGroups = normalizeIds(audience.groupIds);
    const normalizedUsers = normalizeIds(audience.userIds);
    if (normalizedGroups === null || normalizedUsers === null) {
      return { ok: false, error: "invalid_subject" };
    }
    groupIds = normalizedGroups;
    userIds = normalizedUsers;

    if (groupIds.length === 0 && userIds.length === 0) {
      return { ok: false, error: "empty_audience" };
    }
    if (!(await subjectsAreAddressable(tx, ownerId, groupIds, userIds))) {
      return { ok: false, error: "invalid_subject" };
    }
  }

  await tx.delete(wishVisibility).where(eq(wishVisibility.wishId, wishId));
  if (groupIds.length > 0 || userIds.length > 0) {
    await tx.insert(wishVisibility).values([
      ...groupIds.map((id) => ({
        wishId,
        subjectType: "group" as const,
        subjectId: id,
      })),
      ...userIds.map((id) => ({
        wishId,
        subjectType: "user" as const,
        subjectId: id,
      })),
    ]);
  }
  await tx
    .update(wishes)
    .set({ visibility: audience.mode })
    .where(and(eq(wishes.id, wishId), eq(wishes.ownerId, ownerId)));

  return { ok: true };
}

/**
 * Creating a wish and addressing it are one write. A refused audience takes the
 * wish with it rather than leaving a wish visible to everyone that the owner
 * meant to restrict.
 */
export async function createWishWithAudience(
  db: Db,
  ownerId: string,
  input: WishInput,
  audience: WishAudience,
): Promise<WishWithAudienceResult> {
  try {
    return await db.transaction(async (tx) => {
      const created: WishMutationResult = await createWish(tx, ownerId, input);
      if (!created.ok) return created;

      const applied = await setWishAudience(
        tx,
        ownerId,
        created.wish.id,
        audience,
      );
      if (!applied.ok) throw new AudienceRejected(applied.error);

      // `setWishAudience` moved the column the insert defaulted.
      return { ok: true, wish: { ...created.wish, visibility: audience.mode } };
    });
  } catch (error) {
    if (error instanceof AudienceRejected) {
      return { ok: false, error: error.error };
    }
    throw error;
  }
}

/**
 * Replays the visibility rules for one wish and one viewer.
 *
 * SERVER-SIDE ONLY, and only ever for a question about somebody *else*: it is
 * how an owner's edit transaction learns whether the holder of a booking can
 * still see what they booked. Its answer is `after()`-only — it says something
 * about a reserver, so it must never reach a return value the owner sees.
 */
export async function isWishVisibleTo(
  db: Db,
  wishId: string,
  viewer: Viewer,
): Promise<boolean> {
  if (!isUuid(wishId)) return false;

  const rows = await db
    .select({ id: wishes.id })
    .from(wishes)
    .where(and(eq(wishes.id, wishId), visibleTo(viewer)))
    .limit(1);
  return rows.length > 0;
}
