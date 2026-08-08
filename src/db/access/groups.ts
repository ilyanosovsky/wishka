import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";

import type { Db } from "../index";
import {
  groupMembers,
  groups,
  profiles,
  user,
  wishVisibility,
} from "../schema";
import { revokeLiveInvites } from "./group-invites";
import { isUuid } from "./ids";
import { visibleTo } from "./viewer";

/**
 * Groups — the audience a restricted wish can be addressed to.
 *
 * Three rules this module lives by.
 *
 * A NON-MEMBER CAN NEVER DISTINGUISH "the group does not exist" from "you are
 * not in it". Every read and every mutation collapses both cases into the same
 * answer, so a group id handed to an outsider is never an existence oracle.
 *
 * MEMBERSHIP CHANGES ARE VISIBILITY CHANGES. `visibleTo` unlocks a restricted
 * wish through a group the viewer and the owner share, so leaving a group,
 * being removed from it, or having it deleted silently revokes access to every
 * wish restricted to that group. Nothing here warns anybody after the fact —
 * that is why the confirmation dialogs quote the consequence beforehand.
 *
 * REVOKING ACCESS MUST OUTLIVE THE ROW. A removed member still holds whatever
 * invite link they were shown while inside, and one tap on it would hand the
 * whole group back. Removal therefore kills the group's live links as well —
 * see `removeMember`.
 */

export type GroupRole = "admin" | "member";

/** Just enough of a member to draw them on a group card. */
export type GroupMemberAvatar = {
  name: string;
  image: string | null;
};

export type GroupSummary = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  role: GroupRole;
  memberCount: number;
  /** At most `MAX_CARD_AVATARS`, admins first — `memberCount` stays the total. */
  memberAvatars: GroupMemberAvatar[];
  createdAt: Date;
};

export type GroupMember = {
  userId: string;
  name: string;
  image: string | null;
  nickname: string | null;
  role: GroupRole;
  joinedAt: Date;
  /** Wishes of this member visible to the *viewer* — drives "Список пока пуст". */
  hasVisibleWishes: boolean;
};

export type GroupDetail = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  /** The viewer's own role, not the group's. */
  role: GroupRole;
  members: GroupMember[];
};

export type GroupInput = {
  name: string;
  emoji?: string | null;
  color?: string | null;
};

export type GroupValidationError = "name" | "emoji" | "color";

export type GroupMutationResult =
  | { ok: true; group: GroupSummary }
  | { ok: false; error: GroupValidationError | "not_found" | "forbidden" };

/**
 * Opaque swatch keys, not CSS. Each one names a Paper Ledger token the UI maps
 * to a swatch; storing the key (never a hex value) is what lets the palette be
 * restyled — and re-themed for dark mode — without touching stored rows.
 */
export const GROUP_COLORS = [
  "ink",
  "accent",
  "null",
  "zebra",
  "rule",
  "mute",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

const MAX_NAME_LENGTH = 60;
/** Counted in code points: a family emoji is one glyph but many UTF-16 units. */
const MAX_EMOJI_LENGTH = 8;
/** How many faces a group card shows before it falls back to the count (§6.7). */
const MAX_CARD_AVATARS = 3;

type Normalized<T> = { ok: true; value: T } | { ok: false };

function normalizeName(raw: string): Normalized<string> {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return { ok: false };
  return { ok: true, value: name };
}

function normalizeEmoji(
  raw: string | null | undefined,
): Normalized<string | null> {
  const emoji = (raw ?? "").trim();
  if (emoji.length === 0) return { ok: true, value: null };
  if ([...emoji].length > MAX_EMOJI_LENGTH) return { ok: false };
  return { ok: true, value: emoji };
}

function isGroupColor(value: string): value is GroupColor {
  return (GROUP_COLORS as readonly string[]).includes(value);
}

function normalizeColor(
  raw: string | null | undefined,
): Normalized<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  return isGroupColor(raw) ? { ok: true, value: raw } : { ok: false };
}

/**
 * The summary rows for one user's groups. `groupId` narrows it to a single
 * group, which is how the mutations echo their result back without a second
 * shape to keep in sync.
 *
 * Count and faces come from one grouped pass over the membership: a card per
 * group times a query per card would be the same list read N times over.
 */
async function selectSummaries(
  db: Db,
  userId: string,
  groupId?: string,
): Promise<GroupSummary[]> {
  const memberDigest = db
    .select({
      groupId: groupMembers.groupId,
      memberCount: count().as("member_count"),
      // Sliced in SQL, not in JS, so a large group ships three names, not all
      // of them. Same order as the member grid: admins first, then tenure.
      avatars: sql<GroupMemberAvatar[]>`to_jsonb((array_agg(
        jsonb_build_object('name', ${user.name}, 'image', ${user.image})
        order by
          case when ${groupMembers.role} = 'admin' then 0 else 1 end,
          ${groupMembers.joinedAt},
          ${groupMembers.userId}
      ))[1:${sql.raw(String(MAX_CARD_AVATARS))}])`.as("member_avatars"),
    })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .groupBy(groupMembers.groupId)
    .as("member_digest");

  return db
    .select({
      id: groups.id,
      name: groups.name,
      emoji: groups.emoji,
      color: groups.color,
      role: groupMembers.role,
      memberCount: memberDigest.memberCount,
      memberAvatars: memberDigest.avatars,
      createdAt: groups.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(memberDigest, eq(memberDigest.groupId, groups.id))
    .where(
      groupId === undefined
        ? eq(groupMembers.userId, userId)
        : and(eq(groupMembers.userId, userId), eq(groups.id, groupId)),
    )
    .orderBy(desc(groups.createdAt), desc(groups.id));
}

async function selectRole(
  db: Db,
  groupId: string,
  userId: string,
): Promise<GroupRole | null> {
  const rows = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}

/**
 * Locks the group row for the rest of the transaction and hands back the one
 * column its membership mutations have to keep honest.
 *
 * Every transaction that adds or drops a member takes this lock FIRST — one
 * consistent lock order, the same discipline `wish-lifecycle.ts` applies to
 * wishes. Without it two members leaving at once each read the other as
 * remaining, both skip the last-member cleanup, and the group survives with
 * zero members and permanently dangling `wish_visibility` rows. PGlite
 * serialises transactions, so the race cannot be reproduced in tests; the lock
 * is structural, not a fix for anything the suite can show.
 */
export async function lockGroupRow(
  tx: Db,
  groupId: string,
): Promise<{ createdBy: string } | null> {
  const [row] = await tx
    .select({ createdBy: groups.createdBy })
    .from(groups)
    .where(eq(groups.id, groupId))
    .for("update")
    .limit(1);
  return row ?? null;
}

/**
 * Hands over everything a departing member was holding, for both ways out
 * (walking and being removed).
 *
 * The group must keep an admin, and `groups.created_by` must stop naming a
 * non-member: that column cascades on user delete, so a stale `created_by`
 * would let a long-gone member's account deletion take the whole group — and
 * the wishes restricted to it — down with them.
 *
 * `remaining` is every other member, ordered by tenure and non-empty.
 */
async function handOver(
  tx: Db,
  groupId: string,
  departingId: string,
  createdBy: string,
  remaining: { userId: string; role: GroupRole }[],
): Promise<void> {
  const heir =
    remaining.find((member) => member.role === "admin") ?? remaining[0];
  if (heir.role !== "admin") {
    await tx
      .update(groupMembers)
      .set({ role: "admin" })
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, heir.userId),
        ),
      );
  }
  if (createdBy === departingId) {
    await tx
      .update(groups)
      .set({ createdBy: heir.userId })
      .where(eq(groups.id, groupId));
  }
}

/** Every other member of a group, longest-tenured first. */
async function selectRemaining(
  tx: Db,
  groupId: string,
  departingId: string,
): Promise<{ userId: string; role: GroupRole }[]> {
  return tx
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        ne(groupMembers.userId, departingId),
      ),
    )
    .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.userId));
}

/** The creator is the first admin — a group is never left without one. */
export async function createGroup(
  db: Db,
  userId: string,
  input: GroupInput,
): Promise<GroupMutationResult> {
  const name = normalizeName(input.name);
  if (!name.ok) return { ok: false, error: "name" };
  const emoji = normalizeEmoji(input.emoji);
  if (!emoji.ok) return { ok: false, error: "emoji" };
  const color = normalizeColor(input.color);
  if (!color.ok) return { ok: false, error: "color" };

  return db.transaction(async (tx) => {
    const [group] = await tx
      .insert(groups)
      .values({
        name: name.value,
        emoji: emoji.value,
        color: color.value,
        createdBy: userId,
      })
      .returning({ id: groups.id, createdAt: groups.createdAt });

    await tx
      .insert(groupMembers)
      .values({ groupId: group.id, userId, role: "admin" });

    const [creator] = await tx
      .select({ name: user.name, image: user.image })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    return {
      ok: true,
      group: {
        id: group.id,
        name: name.value,
        emoji: emoji.value,
        color: color.value,
        role: "admin",
        memberCount: 1,
        memberAvatars: creator ? [creator] : [],
        createdAt: group.createdAt,
      },
    };
  });
}

export async function getMyGroups(
  db: Db,
  userId: string,
): Promise<GroupSummary[]> {
  return selectSummaries(db, userId);
}

export async function isGroupMember(
  db: Db,
  groupId: string,
  userId: string,
): Promise<boolean> {
  if (!isUuid(groupId)) return false;
  return (await selectRole(db, groupId, userId)) !== null;
}

/**
 * Null for a missing group *and* for a group the viewer is not in — one answer,
 * no oracle.
 *
 * `hasVisibleWishes` is asked per member through `visibleTo`, the same rule the
 * list itself is read by, so the member grid can never advertise a list the
 * viewer would then be refused.
 */
export async function getGroupDetail(
  db: Db,
  groupId: string,
  viewerId: string,
): Promise<GroupDetail | null> {
  if (!isUuid(groupId)) return null;

  const viewerRole = await selectRole(db, groupId, viewerId);
  if (viewerRole === null) return null;

  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      emoji: groups.emoji,
      color: groups.color,
    })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return null;

  const members = await db
    .select({
      userId: groupMembers.userId,
      name: user.name,
      image: user.image,
      nickname: profiles.nickname,
      role: groupMembers.role,
      joinedAt: groupMembers.joinedAt,
      hasVisibleWishes: sql<boolean>`exists (
        select 1 from "wishes"
        where "wishes"."owner_id" = ${groupMembers.userId}
          and "wishes"."status" = 'active'
          and ${visibleTo({ userId: viewerId })}
      )`,
    })
    .from(groupMembers)
    .innerJoin(user, eq(user.id, groupMembers.userId))
    .leftJoin(profiles, eq(profiles.userId, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(
      sql`case when ${groupMembers.role} = 'admin' then 0 else 1 end`,
      asc(groupMembers.joinedAt),
      asc(groupMembers.userId),
    );

  return { ...group, role: viewerRole, members };
}

/**
 * Rename and restyle are shared, not admin-only (§6.7 keeps only delete and
 * remove-member behind the admin badge).
 *
 * A caller who is not a member is `forbidden` whether or not the group exists —
 * `not_found` is reserved for the group disappearing under a member mid-call.
 */
export async function updateGroup(
  db: Db,
  groupId: string,
  userId: string,
  input: Partial<GroupInput>,
): Promise<GroupMutationResult> {
  if (!isUuid(groupId)) return { ok: false, error: "forbidden" };

  const patch: { name?: string; emoji?: string | null; color?: string | null } =
    {};
  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (!name.ok) return { ok: false, error: "name" };
    patch.name = name.value;
  }
  if (input.emoji !== undefined) {
    const emoji = normalizeEmoji(input.emoji);
    if (!emoji.ok) return { ok: false, error: "emoji" };
    patch.emoji = emoji.value;
  }
  if (input.color !== undefined) {
    const color = normalizeColor(input.color);
    if (!color.ok) return { ok: false, error: "color" };
    patch.color = color.value;
  }

  if ((await selectRole(db, groupId, userId)) === null) {
    return { ok: false, error: "forbidden" };
  }

  if (Object.keys(patch).length > 0) {
    await db.update(groups).set(patch).where(eq(groups.id, groupId));
  }

  const [group] = await selectSummaries(db, userId, groupId);
  return group ? { ok: true, group } : { ok: false, error: "not_found" };
}

/** Leaving is also the last member's way of deleting the group. */
export async function leaveGroup(
  db: Db,
  groupId: string,
  userId: string,
): Promise<
  { ok: true; groupDeleted: boolean } | { ok: false; reason: "not_found" }
> {
  if (!isUuid(groupId)) return { ok: false, reason: "not_found" };

  return db.transaction(async (tx) => {
    const group = await lockGroupRow(tx, groupId);
    if (group === null) return { ok: false, reason: "not_found" };

    const role = await selectRole(tx, groupId, userId);
    if (role === null) return { ok: false, reason: "not_found" };

    const remaining = await selectRemaining(tx, groupId, userId);
    if (remaining.length === 0) {
      await deleteGroupRows(tx, groupId);
      return { ok: true, groupDeleted: true };
    }

    await tx
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
      );
    await handOver(tx, groupId, userId, group.createdBy, remaining);

    return { ok: true, groupDeleted: false };
  });
}

/**
 * Admin-only, and never a way out for the admin themselves: removing yourself
 * would skip `leaveGroup`'s succession, leaving the group admin-less.
 *
 * Dropping the membership row is only half of it. The group has one live invite
 * link, any member may read it from the menu, and the person being removed has
 * had every chance to — so the row alone buys nothing: one tap on the link they
 * kept and they are back in, holding every wish restricted to this group again.
 * A removal is a security event, so it kills the group's live links for
 * everybody; whoever is left mints a fresh one by sharing again.
 */
export async function removeMember(
  db: Db,
  groupId: string,
  adminId: string,
  memberId: string,
): Promise<{ ok: boolean }> {
  if (!isUuid(groupId) || adminId === memberId) return { ok: false };

  return db.transaction(async (tx) => {
    const group = await lockGroupRow(tx, groupId);
    if (group === null) return { ok: false };

    if ((await selectRole(tx, groupId, adminId)) !== "admin") {
      return { ok: false };
    }

    const remaining = await selectRemaining(tx, groupId, memberId);
    const removed = await tx
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, memberId),
        ),
      )
      .returning({ userId: groupMembers.userId });
    if (removed.length === 0) return { ok: false };

    // The remover is an admin and is never the removed member, so the group
    // keeps an admin here; `handOver` runs for `created_by`'s sake.
    await handOver(tx, groupId, memberId, group.createdBy, remaining);
    await revokeLiveInvites(tx, groupId);

    return { ok: true };
  });
}

/**
 * `wish_visibility.subject_id` is text with no foreign key (group ids are uuid,
 * user ids are text), so deleting the group cannot cascade into it. Nothing
 * else ever would either — clear the rows here or they are dangling forever,
 * and a recycled id would silently re-open someone's restricted wishes.
 */
async function deleteGroupRows(db: Db, groupId: string): Promise<void> {
  await db
    .delete(wishVisibility)
    .where(
      and(
        eq(wishVisibility.subjectType, "group"),
        eq(wishVisibility.subjectId, groupId),
      ),
    );
  await db.delete(groups).where(eq(groups.id, groupId));
}

/** Admin-only. Members and invites go with the group by cascade. */
export async function deleteGroup(
  db: Db,
  groupId: string,
  adminId: string,
): Promise<{ ok: boolean }> {
  if (!isUuid(groupId)) return { ok: false };

  return db.transaction(async (tx) => {
    if ((await lockGroupRow(tx, groupId)) === null) return { ok: false };
    if ((await selectRole(tx, groupId, adminId)) !== "admin") {
      return { ok: false };
    }
    await deleteGroupRows(tx, groupId);
    return { ok: true };
  });
}
