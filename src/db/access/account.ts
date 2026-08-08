import { and, eq } from "drizzle-orm";

import type { Db } from "../index";
import { groupMembers, user, wishVisibility } from "../schema";
import { leaveGroup } from "./groups";

/**
 * Account deletion — the one flow allowed to delete a `user` row directly.
 *
 * `groups.created_by` cascades on user delete. Deleting the row outright would
 * therefore take down every group this account created, including the
 * memberships of everyone still in them — the confirmation copy in
 * `account.deleteBody` promises the opposite ("Группы, где ты админ, перейдут
 * к другим участникам"). So membership has to be wound down FIRST, one group at
 * a time, through `leaveGroup` — the exact same succession rule the "leave a
 * group" flow uses (promote the longest-tenured member, hand `created_by` on,
 * or delete the group outright when this account was its last member) — never
 * duplicated here. Only once every group this account belongs to has been
 * settled is the `user` row itself removed, letting the ordinary cascades
 * (profile, wishes, sessions, bookings) take their course.
 *
 * One transaction, so a crash mid-flight never leaves the account half-deleted
 * (some groups succeeded away from this user, the row itself still standing).
 */
export async function deleteAccount(
  db: Db,
  userId: string,
): Promise<{ ok: boolean }> {
  return db.transaction(async (tx) => {
    const memberships = await tx
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));

    for (const { groupId } of memberships) {
      // `not_found` here means the group was already resolved by an earlier
      // iteration or vanished under us — either way there is nothing left to
      // hand off, so it is not a failure of this deletion.
      await leaveGroup(tx, groupId, userId);
    }

    // `wish_visibility.subject_id` is plain text with no foreign key, so the
    // user cascade cannot reach the rows naming this account on OTHER people's
    // wishes — exactly what `deleteGroupRows` clears for group subjects. Left
    // behind they are dangling forever, and a recycled id would hand a stranger
    // someone's restricted wish.
    //
    // A wish left with no subjects at all stays `restricted` on purpose: it
    // then reaches nobody but its owner, who can re-address it. Widening it to
    // `everyone` would publish a wish its owner deliberately narrowed, on an
    // event they never saw.
    await tx
      .delete(wishVisibility)
      .where(
        and(
          eq(wishVisibility.subjectType, "user"),
          eq(wishVisibility.subjectId, userId),
        ),
      );

    const deleted = await tx
      .delete(user)
      .where(eq(user.id, userId))
      .returning({ id: user.id });

    return { ok: deleted.length > 0 };
  });
}
