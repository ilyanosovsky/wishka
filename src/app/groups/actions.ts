"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import {
  getOrCreateActiveInvite,
  revokeGroupInvites,
} from "@/db/access/group-invites";
import {
  createGroup,
  deleteGroup,
  leaveGroup,
  removeMember,
  updateGroup,
  type GroupInput,
  type GroupMutationResult,
} from "@/db/access/groups";
import { getAuth } from "@/lib/auth";
import { loginHrefWithNext } from "@/lib/next-param";

/**
 * Group mutations (§6.7). Every rule that matters — who may rename, who may
 * delete, what happens to the last admin — lives in `@/db/access/groups`; these
 * actions only bind a session to it and revalidate what the change is visible
 * on. A caller who is not a member gets the same `forbidden`/`ok: false` as one
 * acting on a group that never existed.
 */

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect(loginHrefWithNext("/people"));
  return session.user.id;
}

/** Membership changes rewrite both the tab and the group screen. */
function revalidateGroup(groupId: string): void {
  revalidatePath("/people");
  revalidatePath(`/groups/${groupId}`);
}

export async function createGroupAction(
  input: GroupInput,
): Promise<GroupMutationResult> {
  const userId = await requireUserId();
  const result = await createGroup(getDb(), userId, input);
  if (result.ok) revalidatePath("/people");
  return result;
}

export async function updateGroupAction(
  groupId: string,
  input: Partial<GroupInput>,
): Promise<GroupMutationResult> {
  const userId = await requireUserId();
  const result = await updateGroup(getDb(), groupId, userId, input);
  if (result.ok) revalidateGroup(groupId);
  return result;
}

export async function leaveGroupAction(
  groupId: string,
): Promise<{ ok: boolean; groupDeleted: boolean }> {
  const userId = await requireUserId();
  const result = await leaveGroup(getDb(), groupId, userId);
  if (!result.ok) return { ok: false, groupDeleted: false };
  revalidateGroup(groupId);
  return { ok: true, groupDeleted: result.groupDeleted };
}

export async function deleteGroupAction(
  groupId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const result = await deleteGroup(getDb(), groupId, userId);
  if (result.ok) revalidateGroup(groupId);
  return result;
}

export async function removeMemberAction(
  groupId: string,
  memberId: string,
): Promise<{ ok: boolean }> {
  const adminId = await requireUserId();
  const result = await removeMember(getDb(), groupId, adminId, memberId);
  if (result.ok) revalidateGroup(groupId);
  return result;
}

/**
 * The invite link for the share sheet. Falls back to a path when the app URL is
 * not configured — ShareSheet completes it against the current origin, the same
 * way it does for a list link.
 */
export async function createInviteLinkAction(
  groupId: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const userId = await requireUserId();
  const invite = await getOrCreateActiveInvite(getDb(), groupId, userId);
  if (!invite) return { ok: false };
  return {
    ok: true,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invite/${invite.token}`,
  };
}

/**
 * Kills every live link to the group — the only remedy once one has leaked.
 * Admin-only, enforced in the data layer. Nothing is revalidated: no page
 * renders an invite token, the next «Пригласить» simply mints a new one.
 */
export async function revokeInviteLinkAction(
  groupId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  return revokeGroupInvites(getDb(), groupId, userId);
}
