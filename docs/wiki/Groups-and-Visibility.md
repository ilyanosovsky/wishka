# Groups and Visibility

> Phase 8a. The group model, invite links, and how group membership feeds into who can see a restricted wish. The live "Кому видно" sheet, partner, view-as, and delete-account arrive in Phase 8b (see the note at the bottom).

## The group model

A group is a named, colored/emoji-tagged bucket of members (`groups`, `group_members` — `src/db/schema.ts`, access in `src/db/access/groups.ts`). Every member has a role, `admin` or `member`; the creator is the first admin, and a group is never left without one (see "Leaving and succession" below).

Two rules the data-access module is built around:

- **A non-member can never distinguish "the group does not exist" from "you are not in it".** `getGroupDetail` returns `null` for both a missing id and a group the viewer isn't in — one answer, no oracle. `updateGroup` reports `forbidden` for a non-member the same way whether or not the group exists.
- **Membership changes are visibility changes.** Restricted wishes can name a group as their audience (`wish_visibility`, `subject_type = 'group'`); leaving, being removed, or the group being deleted silently revokes access to every wish restricted to it. Nothing warns anybody after the fact — that's why the leave/remove/delete confirmations in the UI spell out the consequence up front, not the data layer.

### Rename, appearance, and color tokens

Rename and appearance (emoji + color) are open to **any member**, not just admins (§6.7 keeps only delete-group and remove-member behind the admin badge). Color is stored as an opaque key from a fixed allow-list, `GROUP_COLORS` in `groups.ts` (`ink`, `accent`, `null`, `zebra`, `rule`, `mute`) — each name is a Paper Ledger CSS token, never a stored hex value, so the palette (and dark-theme mapping) can change without touching a row.

### Leaving and succession

`leaveGroup` runs as one transaction:

1. The caller must be a member, or the call is a no-op `not_found`.
2. If they're the **only** member, the group is deleted outright (`groupDeleted: true`) — including its `wish_visibility` rows (see below).
3. Otherwise their membership is removed. If they were the **only admin**, the longest-tenured remaining member (`joinedAt asc, userId asc`) is promoted to admin, and `groups.createdBy` is reassigned to them in the same transaction.

That last step matters because `createdBy` cascades on user delete: without reassigning it, a group could be taken down months later by the *original* creator deleting their account, long after they'd walked away and someone else was running it.

### Deleting a group

`deleteGroup` is admin-only. `wish_visibility.subject_id` is a plain `text` column with **no foreign key** — group ids are uuid, user ids are text, so one column can't reference both tables — meaning nothing cascades into it automatically. `deleteGroup` (and the "last member leaves" path in `leaveGroup`) deletes the group's `wish_visibility` rows itself, before deleting the group. Skipping that step would leave dangling rows that a *recycled* group id could later match, silently re-opening wishes that were restricted to a group that no longer exists.

`removeMember` is admin-only, refuses to remove yourself (that's what `leaveGroup`'s succession logic is for), and refuses a target who isn't a member. It never promotes anyone — only a leaving admin triggers succession — but it *does* hand `createdBy` on when the person being removed happens to be the creator, for the same cascade reason.

**Removing a member revokes the group's live invite links.** This is the part that makes eviction real. The invite link is a single reusable token that any member can read from the group menu, so a removed member who kept the URL could otherwise re-join in one tap and get every group-restricted wish back — making the confirmation's promise ("Желания, видимые только этой группе, станут ему недоступны") false. `removeMember` therefore calls `revokeLiveInvites` inside its own transaction. The cost is that everyone else's copy of the link dies too; that is the right trade, because removal is a security event and any remaining member can mint a fresh link from the menu. A *refused* removal revokes nothing.

## The invite model

Groups are joined through a link, never a code or an email address (`group_invites` — `src/db/access/group-invites.ts`).

- **The invite row's id *is* the token.** A uuid v4 is unguessable on its own, so the link carries its own authorization — there's no separate secret to store or compare.
- **`getOrCreateActiveInvite(db, groupId, userId)`** is member-only. It reuses the newest invite that is neither revoked nor expired, so re-opening "Ссылка-приглашение" doesn't mint a fresh link every time — an already-shared link keeps working. A revoked or expired invite is never resurrected; a fresh row is inserted instead, `expiresAt = now + INVITE_TTL_DAYS` (14 days).
- **`lookupInvite(db, token)`** classifies a token as `valid` / `expired` / `revoked` / `not_found`. A non-uuid token short-circuits to `not_found` before touching the database (Postgres would otherwise raise on a malformed uuid literal). Revocation outranks expiry in the classification — a holder is told the link was withdrawn, not that they were merely too slow.
- **`acceptInvite(db, token, userId)`** is idempotent by construction: the lookup happens *inside* the transaction (so a revocation racing an accept can't be read stale), an existing member is answered `alreadyMember: true` with no write, and a double-tap that slips past that check lands on `onConflictDoNothing()` rather than a unique-violation error — joining twice is not a failure, it's the same outcome reached twice.
- **`revokeGroupInvites(db, groupId, adminId)`** is admin-only and kills every live link of the group at once, reachable from the group menu as «Отозвать ссылку». There's no per-link UI to revoke a single link, because the only reason to revoke is that a link escaped somewhere, and the group has no way to know how far. It only touches links that are still live — an already-expired invite keeps reading as `expired` rather than being retold as `revoked`, so the two states stay honest about what happened.
- **Membership mutations serialize on the group row.** `leaveGroup`, `removeMember`, `deleteGroup` and `acceptInvite` all take `select … from groups where id = ? for update` as the first statement of their transaction, in that one consistent order. Without it, two members leaving at the same instant each read the other as still present, skip the last-member cleanup, and leave behind a group with zero members whose `wish_visibility` rows nothing will ever collect. PGlite serializes transactions, so the race is not reproducible in tests — the lock is structural, the same approach `wish-lifecycle.ts` takes for wishes.

### `/invite/<token>` — the acceptance screen

Server component (`src/app/invite/[token]/page.tsx`) branches on `lookupInvite`'s classification, then (for a `valid` token) on session state:

| State | Screen |
|---|---|
| `expired` / `revoked` | `ServiceScreen` — "Приглашение истекло" → `/` |
| `not_found` | `ServiceScreen` — "Ссылка недействительна…" → `/` |
| `valid`, no session | Group name + explanation, CTA to `/login?next=/invite/<token>` (`loginHrefWithNext`) |
| `valid`, signed in, already a member | `ServiceScreen` — "Вы уже в группе «name»" → `/groups/<id>` |
| `valid`, signed in, not a member | The one interactive step: `acceptInviteAction` → `router.push('/groups/<id>')` |

`acceptInviteAction` (`src/app/invite/[token]/actions.ts`) requires a session (`unauthenticated` otherwise — a defense-in-depth result, since the page itself already branches on session presence before rendering the accept button) and calls `acceptInvite`. How the client handles a failure depends on what failed: a result that says the token itself died between render and tap (`expired`, `revoked`, `not_found`) sends the visitor to `/`, and `unauthenticated` sends them to `/login?next=…`. Only a *thrown* action — a dropped connection, or the group being deleted mid-flight — keeps them on the screen with an inline error and the button re-enabled, because there the token may still be good and retrying in place is the honest recovery.

Unlike the guest manage-booking link (`/g/<token>`, see [Guest Access](Guest-Access)), a group invite token is not treated as a bearer secret to stay quiet about: `expired` / `revoked` / `not_found` each get their own explanation instead of a silent redirect, because a group invite is meant to be shown and explained, not probed for validity by an attacker.

### Sharing the link

The group detail meatball menu's "Ссылка-приглашение" calls `createInviteLinkAction`, then opens the same `ShareSheet` component used for wish and list sharing (`src/components/wishes/share-sheet.tsx`), with `kind="group"`. A group invite link is never `restricted`, so it takes the plain copy-link/native-share body — no warning step.

## How group membership feeds `visibleTo()`

`visibleTo(viewer)` in `src/db/access/viewer.ts` is the single rule every visibility-aware read goes through (list reads, single-wish reads, and now the member grid's "has this person shared anything with me" check) — Phase 8a does not touch this function, it only writes the rows it reads:

```sql
exists (
  select 1 from "wish_visibility" wv
  where wv."wish_id" = wishes.id
    and (
      (wv."subject_type" = 'user' and wv."subject_id" = <viewer userId>)
      or (
        wv."subject_type" = 'group'
        and exists (
          select 1
          from "group_members" gm_viewer
          join "group_members" gm_owner
            on gm_owner."group_id" = gm_viewer."group_id"
          where gm_viewer."group_id"::text = wv."subject_id"
            and gm_viewer."user_id" = <viewer userId>
            and gm_owner."user_id" = wishes.owner_id
        )
      )
    )
)
```

A `restricted` wish naming a group is visible to a viewer exactly when the viewer and the wish's owner are **both currently members of that group** — it's a live join, not a snapshot taken when the wish was restricted. That's what "membership changes are visibility changes" means concretely:

- **Someone leaves (or is removed from) a group** the owner used to restrict a wish to → the `gm_viewer` row disappears → the `exists` clause stops matching → the wish disappears from that person's view of the list on their very next read. No event, no notice — the row is just gone.
- **Someone re-joins via `acceptInvite`** → the `group_members` row comes back → the same wish reappears, with no separate re-grant step, because visibility was never stored per-person for a group-restricted wish; it's derived fresh from current membership every time.
- **The group is deleted** → both the group-membership join *and* the `wish_visibility` row naming it are gone (the latter because `deleteGroup` cleans it up explicitly, as noted above) — the wish falls back to whatever other visibility rows it has, or stops being restricted-reachable by that route entirely.

`getGroupDetail`'s `hasVisibleWishes` per member reuses this exact function (`visibleTo({ userId: viewerId })` against that member's wishes) rather than re-implementing any part of the rule — the member grid can never advertise a "Открыть список" link the viewer would then be refused by `/u/<nickname>`.

## What 8b will add

Phase 8a builds the audience groups can address — 8b makes that audience selectable and adds the remaining §6 surfaces that depend on it:

- The live "Кому видно" sheet on a wish (everyone / selected groups / selected people, partner pinned) — the UI that actually *writes* `wish_visibility` rows for groups and individual people; 8a's groups exist and can be reasoned about, but nothing outside tests writes a group-restriction row yet.
- Partner: assigning/removing a partner from a group's members, surfaced in `/profile`.
- "Посмотреть, как видят другие" — view-as a guest, a specific group, or a specific person, with a preview banner. Reservations must never appear in this preview (the same rule `getWishesAsSeenBy` already enforces for the plain owner-preview case).
- The narrowing-after-reservation rule: if an owner narrows a wish's visibility after someone has reserved it, the reservation itself survives but the reserver loses the ability to see the wish again — with an email explaining why.
- Delete-account.
