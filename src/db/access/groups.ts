import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";

import type { Db } from "../index";
import {
  groupMembers,
  groups,
  profiles,
  user,
  wishVisibility,
} from "../schema";
import { isUuid } from "./ids";
import { visibleTo } from "./viewer";

/**
 * Groups — the audience a restricted wish can be addressed to.
 *
 * Two rules this module lives by.
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
 */

export type GroupRole = "admin" | "member";

export type GroupSummary = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  role: GroupRole;
  memberCount: number;
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
 */
async function selectSummaries(
  db: Db,
  userId: string,
  groupId?: string,
): Promise<GroupSummary[]> {
  const memberCounts = db
    .select({
      groupId: groupMembers.groupId,
      memberCount: count().as("member_count"),
    })
    .from(groupMembers)
    .groupBy(groupMembers.groupId)
    .as("member_counts");

  return db
    .select({
      id: groups.id,
      name: groups.name,
      emoji: groups.emoji,
      color: groups.color,
      role: groupMembers.role,
      memberCount: memberCounts.memberCount,
      createdAt: groups.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .innerJoin(memberCounts, eq(memberCounts.groupId, groups.id))
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

    return {
      ok: true,
      group: {
        id: group.id,
        name: name.value,
        emoji: emoji.value,
        color: color.value,
        role: "admin",
        memberCount: 1,
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

/**
 * Leaving is also the last member's way of deleting the group.
 *
 * The tricky case is the last *admin* leaving: the group must keep an admin,
 * and `groups.created_by` must stop pointing at the leaver — that column
 * cascades on user delete, so a stale `created_by` would take the whole group
 * down with the leaver's account long after they walked away.
 */
export async function leaveGroup(
  db: Db,
  groupId: string,
  userId: string,
): Promise<
  { ok: true; groupDeleted: boolean } | { ok: false; reason: "not_found" }
> {
  if (!isUuid(groupId)) return { ok: false, reason: "not_found" };

  return db.transaction(async (tx) => {
    const role = await selectRole(tx, groupId, userId);
    if (role === null) return { ok: false, reason: "not_found" };

    const remaining = await tx
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), ne(groupMembers.userId, userId)),
      )
      .orderBy(asc(groupMembers.joinedAt), asc(groupMembers.userId));

    if (remaining.length === 0) {
      await deleteGroupRows(tx, groupId);
      return { ok: true, groupDeleted: true };
    }

    await tx
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
      );

    if (!remaining.some((member) => member.role === "admin")) {
      const heir = remaining[0].userId;
      await tx
        .update(groupMembers)
        .set({ role: "admin" })
        .where(
          and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, heir)),
        );
      await tx
        .update(groups)
        .set({ createdBy: heir })
        .where(eq(groups.id, groupId));
    }

    return { ok: true, groupDeleted: false };
  });
}

/**
 * Admin-only, and never a way out for the admin themselves: removing yourself
 * would skip `leaveGroup`'s succession, leaving the group admin-less.
 */
export async function removeMember(
  db: Db,
  groupId: string,
  adminId: string,
  memberId: string,
): Promise<{ ok: boolean }> {
  if (!isUuid(groupId) || adminId === memberId) return { ok: false };

  if ((await selectRole(db, groupId, adminId)) !== "admin") {
    return { ok: false };
  }

  const removed = await db
    .delete(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, memberId)),
    )
    .returning({ userId: groupMembers.userId });

  return { ok: removed.length > 0 };
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
    if ((await selectRole(tx, groupId, adminId)) !== "admin") {
      return { ok: false };
    }
    await deleteGroupRows(tx, groupId);
    return { ok: true };
  });
}
