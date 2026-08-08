"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { acceptInvite } from "@/db/access/group-invites";
import { getAuth } from "@/lib/auth";

export type AcceptInviteActionResult =
  | { ok: true; groupId: string; groupName: string; alreadyMember: boolean }
  | {
      ok: false;
      state: "expired" | "revoked" | "not_found" | "unauthenticated";
    };

/**
 * The invite-acceptance CTA on `/invite/<token>`. Session-gated here rather
 * than by redirecting the page — the page already branched on session
 * presence before showing this action's button, so `unauthenticated` is a
 * defense-in-depth result, not the expected path.
 */
export async function acceptInviteAction(
  token: string,
): Promise<AcceptInviteActionResult> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return { ok: false, state: "unauthenticated" };

  const result = await acceptInvite(getDb(), token, session.user.id);
  if (!result.ok) return result;

  revalidatePath("/people");
  revalidatePath(`/groups/${result.groupId}`);
  return {
    ok: true,
    groupId: result.groupId,
    groupName: result.groupName,
    alreadyMember: result.alreadyMember,
  };
}
