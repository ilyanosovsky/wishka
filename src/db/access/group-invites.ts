import { and, desc, eq, gt, isNull } from "drizzle-orm";

import type { Db } from "../index";
import { groupInvites, groupMembers, groups } from "../schema";
import { isGroupMember, lockGroupRow } from "./groups";
import { isUuid } from "./ids";

/**
 * Group invites — a link, never an address.
 *
 * The invite row's id *is* the token: a uuid v4 is unguessable, so the link
 * carries its own authorisation and no separate secret has to be stored or
 * compared. That also means a leaked link is the whole of the exposure, which
 * is why invites expire and can be revoked wholesale.
 *
 * Membership granted here is a visibility change — see the note in `groups.ts`.
 */

export type InviteState = "valid" | "expired" | "revoked" | "not_found";

export type InviteLookup =
  | {
      state: "valid";
      token: string;
      groupId: string;
      groupName: string;
      groupEmoji: string | null;
    }
  | { state: "expired" | "revoked" | "not_found" };

export type AcceptResult =
  | { ok: true; groupId: string; groupName: string; alreadyMember: boolean }
  | { ok: false; state: "expired" | "revoked" | "not_found" };

export const INVITE_TTL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

function expiryFromNow(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS);
}

/**
 * One live link per group: sharing again re-shares the same token instead of
 * minting a new one, so an already-sent link keeps working. A revoked or
 * expired one is never resurrected — that would undo the revocation.
 */
export async function getOrCreateActiveInvite(
  db: Db,
  groupId: string,
  userId: string,
): Promise<{ token: string } | null> {
  if (!isUuid(groupId)) return null;
  if (!(await isGroupMember(db, groupId, userId))) return null;

  const [live] = await db
    .select({ token: groupInvites.id })
    .from(groupInvites)
    .where(
      and(
        eq(groupInvites.groupId, groupId),
        isNull(groupInvites.revokedAt),
        gt(groupInvites.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(groupInvites.createdAt), desc(groupInvites.id))
    .limit(1);
  if (live) return { token: live.token };

  const [created] = await db
    .insert(groupInvites)
    .values({ groupId, createdBy: userId, expiresAt: expiryFromNow() })
    .returning({ token: groupInvites.id });
  return { token: created.token };
}

/**
 * A token that is not a uuid never reaches the database: Postgres raises 22P02
 * on a malformed uuid literal, and a mistyped link must read as "not found".
 */
export async function lookupInvite(
  db: Db,
  token: string,
): Promise<InviteLookup> {
  if (!isUuid(token)) return { state: "not_found" };

  const [invite] = await db
    .select({
      token: groupInvites.id,
      groupId: groupInvites.groupId,
      groupName: groups.name,
      groupEmoji: groups.emoji,
      expiresAt: groupInvites.expiresAt,
      revokedAt: groupInvites.revokedAt,
    })
    .from(groupInvites)
    // Inner join: an invite whose group is gone went with it by cascade.
    .innerJoin(groups, eq(groups.id, groupInvites.groupId))
    .where(eq(groupInvites.id, token))
    .limit(1);
  if (!invite) return { state: "not_found" };

  // Revocation is a deliberate act and outranks expiry: the holder should be
  // told the link was withdrawn, not that they were merely too slow.
  if (invite.revokedAt !== null) return { state: "revoked" };
  if (invite.expiresAt.getTime() <= Date.now()) return { state: "expired" };

  return {
    state: "valid",
    token: invite.token,
    groupId: invite.groupId,
    groupName: invite.groupName,
    groupEmoji: invite.groupEmoji,
  };
}

/**
 * Idempotent by construction: an existing member is answered without a write,
 * and a double-tap that slips past that check lands on `on conflict do nothing`
 * rather than a unique violation — joining twice is not an error, it is the
 * same outcome reached twice.
 *
 * The lookup happens inside the transaction so a revocation racing the accept
 * cannot be read before and applied after.
 */
export async function acceptInvite(
  db: Db,
  token: string,
  userId: string,
): Promise<AcceptResult> {
  if (!isUuid(token)) return { ok: false, state: "not_found" };

  return db.transaction(async (tx) => {
    // The group row is locked before anything is read for a decision or
    // written, the same order every membership mutation takes it in — the
    // token only has to be resolved to a group id first, and that read decides
    // nothing: `lookupInvite` re-reads the invite under the lock.
    const [invited] = await tx
      .select({ groupId: groupInvites.groupId })
      .from(groupInvites)
      .where(eq(groupInvites.id, token))
      .limit(1);
    if (!invited) return { ok: false, state: "not_found" };
    await lockGroupRow(tx, invited.groupId);

    const invite = await lookupInvite(tx, token);
    if (invite.state !== "valid") return { ok: false, state: invite.state };

    const { groupId, groupName } = invite;
    if (await isGroupMember(tx, groupId, userId)) {
      return { ok: true, groupId, groupName, alreadyMember: true };
    }

    const inserted = await tx
      .insert(groupMembers)
      .values({ groupId, userId, role: "member" })
      .onConflictDoNothing()
      .returning({ userId: groupMembers.userId });

    return {
      ok: true,
      groupId,
      groupName,
      alreadyMember: inserted.length === 0,
    };
  });
}

/**
 * Kills every link of a group that could still be walked in on — there is no
 * per-link UI, and the only reason to revoke is that a link escaped, which the
 * group cannot know the extent of.
 *
 * Only live rows are touched: an already-revoked one keeps its original
 * timestamp, and an expired one stays "expired", so a holder is never told a
 * link was withdrawn when it had simply run out.
 *
 * Unauthenticated on purpose — the callers each establish their own right to do
 * it (`revokeGroupInvites` is the admin-facing one, `removeMember` revokes
 * because it just evicted somebody who may hold the link).
 */
export async function revokeLiveInvites(
  db: Db,
  groupId: string,
): Promise<void> {
  await db
    .update(groupInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(groupInvites.groupId, groupId),
        isNull(groupInvites.revokedAt),
        gt(groupInvites.expiresAt, new Date()),
      ),
    );
}

/** Admin-only revocation, on demand from the group menu. */
export async function revokeGroupInvites(
  db: Db,
  groupId: string,
  adminId: string,
): Promise<{ ok: boolean }> {
  if (!isUuid(groupId)) return { ok: false };

  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, adminId)),
    )
    .limit(1);
  if (membership?.role !== "admin") return { ok: false };

  await revokeLiveInvites(db, groupId);
  return { ok: true };
}
