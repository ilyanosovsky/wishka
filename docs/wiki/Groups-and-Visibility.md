# Groups and Visibility

> Phase 8a: the group model and invite links. Phase 8b: the live "Кому видно" sheet, partner, view-as, and delete-account — see "Who can see a wish" and the sections below it.

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

## Who can see a wish

Every wish has a `wishes.visibility` column — `everyone` or `restricted` — and, when restricted, zero or more `wish_visibility` rows naming who it's addressed to. §6.3 defines exactly **three** visibility modes, no more:

1. **Всем** (`everyone`) — the default. Public, subject to no `wish_visibility` rows at all.
2. **Группам** (`restricted` + `subject_type = 'group'` rows) — visible to any current member of any named group.
3. **Отдельным людям** (`restricted` + `subject_type = 'user'` rows) — visible to the named people directly, regardless of group.

There is deliberately **no fourth "partner-only" mode**, even though §6.6 mentions "только партнёру" in passing. §6.3 — the actual visibility spec — enumerates three, and the partner is simply *pinned first* inside the people picker (mode 3): selecting the partner is selecting a person, not choosing a different mode. `setWishAudience` (below) treats the partner exactly like any other addressable person.

### Writing an audience — `src/db/access/visibility.ts`

This module is the **only** place `wish_visibility` rows are written; `viewer.ts`'s `visibleTo()` remains the only place the rule is *read*. No component decides who sees what — invariant #2.

- **`getAudienceCandidates(db, ownerId)`** — everyone the owner may address a wish to: every member of every group they belong to (deduped across groups), plus their partner (`profiles.partnerId`) even if they share no group with them, since being the partner *is* the relationship being addressed. The partner sorts first, then alphabetically — the whole of §6.3's "pinned".
- **`getWishAudience(db, ownerId, wishId)`** — the current audience of one of the owner's own wishes, for the edit form. A wish that isn't theirs comes back `null`, indistinguishable from a missing one — an id is never an existence oracle.
- **`setWishAudience(tx, ownerId, wishId, audience)`** — replaces a wish's audience wholesale, inside a caller-supplied transaction (so a wish write and its audience land or fail together). Validation is **server-side and total** — the picker's candidate list is a suggestion, not a guarantee, since a hand-crafted payload must never be able to address a wish to a group the owner isn't in or a person they have no relationship with:
  - every `groupId` must be a group the owner is currently a member of;
  - every `userId` must currently share a group with the owner **or be their partner**;
  - a `restricted` audience with **zero** subjects is refused as `empty_audience` rather than silently hiding the wish from everybody — never what picking «отдельным людям» and forgetting to tick a name meant;
  - anything else (malformed ids, a non-uuid group, the owner naming themselves) is `invalid_subject`.
  - Selecting `everyone` clears every `wish_visibility` row for the wish.
- **`createWishWithAudience(db, ownerId, input, audience)`** — creates the wish and applies its audience in one transaction; a refused audience unwinds the whole write rather than leaving a wish visible to everyone that the owner meant to restrict.
- **`isWishVisibleTo(db, wishId, viewer)`** — replays `visibleTo()` for one wish and one viewer. SERVER-SIDE ONLY and only ever asked about somebody *else* — see the narrowing rule below, the one caller that needs it.

### The `{ groupId }` viewer — "as any member of this group sees it"

`Viewer` (`src/db/access/types.ts`) gained a fourth shape: `{ groupId: string }`. `visibleTo()` treats it as seeing `everyone` wishes plus every wish restricted to that group — the honest lens for "how does this group see my list", distinct from simulating one arbitrary real member (who would also pick up whatever they're named in *individually*, which isn't the question view-as is answering). It is deliberately **not** part of the `Reserver` union, so no reservation path can ever receive one — a `{ groupId }` viewer can look, never book.

### The «Кому видно» sheet — `src/components/wishes/visibility-sheet.tsx`

Wired into `wish-form.tsx`, replacing the Phase 7a stub row. Three modes as a radio-style list (`visibility.everyone` / `.groups` / `.people`); the groups mode is **not offered at all** when the owner is in zero groups (`visibility.noGroups` + a link to create one), and the people mode shows `visibility.noPeople` when there are no candidates. `visibility.emptyAudience` blocks confirming a restricted audience with nothing selected — the client-side twin of `setWishAudience`'s `empty_audience`.

A static footnote, `visibility.narrowNote`, is shown **unconditionally** — never only when a booking exists. A note that appeared conditionally would itself be an oracle telling the owner a wish is reserved, which is exactly what invariant #1 forbids.

## Narrowing after a reservation

If an owner narrows a wish's visibility (or switches it to a `restricted` audience) after someone has reserved it, the booking is not touched — reservations are never affected by a visibility change — but the reserver may lose the ability to *see* the wish. This is the trickiest corner of invariant #1: the mutation has to learn something about a specific person's sight of the wish, without ever letting that fact reach the owner.

`updateWishAsOwner` (`src/db/access/wish-lifecycle.ts`) gained an optional `audience` parameter and, in the same transaction, an unconditional extra step. It captures the active reservation's holder — a `{ userId }` or `{ guestId }` viewer built from the reservation row, never anything the owner supplied — and **replays `isWishVisibleTo` for that holder twice: once before the write, once after**. The flag is the difference:

```
reserverLostAccess = holder !== null && visibleBefore && !visibleAfter
```

It is deliberately a **transition, not a state**. "The holder cannot see this wish" is true forever once a booked wish is restricted, so a post-only check would re-send the email on every later save — a typo fix in the notes would mail them again — and, worse, it would fire when the holder left the audience *on their own* (leaving the group), telling them the owner did something the owner never did, and suppressing the legitimate "the owner changed this wish" mail in the process. A guest holder makes the state version permanent, since a guest can never see any `restricted` wish.

Both probes run on **every** successful save — audience or no audience, booking or no booking — and only the *answer* differs. The owner-visible `result` is built solely from the wish write and the audience outcome, so it is byte-identical whether or not a reservation exists or was affected. `reserverLostAccess` is `after()`-only, exactly like `notifyReservationId`.

`src/app/wishes/actions.ts`'s `updateWishAction` reads both flags inside `after()`:

- if `reserverLostAccess` is true → `sendReservedWishHidden` (a new sender in `reservation-emails.ts` + `copy.ts`): "the owner changed who can see this, you can't see it anymore — **your booking is still yours**, it's still in «Мои брони»";
- else, if the wish's material fields changed → the existing `sendReservedWishChanged`;
- **never both** — losing access supersedes "the wish changed" because it's the email that actually explains what happened.

The email is params-only (recipient, locale, title — no DB access, no owner identity), swallow-and-log on failure, rendered through `renderLedgerEmail`, following the Phase 7b senders exactly.

## Partner — `src/db/access/profiles.ts`

`setPartner(db, userId, partnerId)` / `clearPartner(db, userId)` touch only the `partnerId` column — every other profile field (nickname, sizes, tastes, base currency…) passes through untouched. `setPartner` refuses two things outright: partnering yourself, and a `partnerId` that shares **no group** with the caller — group co-membership is the only relationship Wishka can vouch for, so it's the only proof accepted. The picker's candidate list already excludes both cases, but the write path holds the line regardless of what the UI sends.

`PartnerBlock` (`src/components/profile/partner-block.tsx`) sits on `/profile` between the public-parameters editor and settings. Picking a candidate *is* the action — there's no separate save step — confirmed with an `InfoToast` (`partner.saved`). With zero candidates it shows `partner.empty` + a link to `/people` to create a group first.

## View-as — `src/components/profile/view-as-sheet.tsx`

"Посмотреть, как видят другие" (§6.6): three lenses — guest, a specific group, or a specific person — over the same candidate list `getAudienceCandidates` returns. Picking a lens navigates to `/u/<own nickname>?as=guest` / `?as=group:<id>` / `?as=user:<id>`.

`/u/[nickname]/page.tsx` only reads `?as=` on the branch where **the viewer is the page's own owner** — a non-owner's `?as=` is ignored entirely, not merely unauthorized-and-logged. The value is validated against what that owner may actually preview through: a `group:<id>` must name a group they belong to, a `user:<id>` must be a real candidate from `getAudienceCandidates`; anything else (a stale id, a hand-typed one, junk) falls back to the plain guest lens rather than erroring, since a preview has nothing sensitive to protect but itself. The resolved viewer — `{ anonymous: true }`, `{ groupId }`, or `{ userId }` — is rendered through **`getWishesAsSeenBy`, never `getVisibleWishes`**, exactly like the plain owner-preview case from Phase 7a: every wish comes back `free`, because that function has no access to the reservations table at all. A `viewAs.banner*` strip names the active lens and links back with `viewAs.exit`.

## Delete account — `src/db/access/account.ts`

Account deletion is a **bespoke server action**, not Better Auth's `deleteUser` (unused in `src/lib/auth.ts`, and it would only remove session/account/user rows — none of the group succession this needs).

The hazard: `groups.created_by` cascades on user delete. Deleting the `user` row outright would take down every group this account created — including the memberships of everyone still in them — the moment that account is gone, which is exactly what the confirmation copy (`account.deleteBody`) promises will *not* happen.

`deleteAccount(db, userId)` runs as one transaction:

1. For every group the account belongs to, it calls **`leaveGroup`** — the same succession rule "leave a group" already uses, never re-implemented: the group is deleted outright if this was its only member (its `wish_visibility` rows go with it), otherwise the membership is dropped, the longest-tenured remaining member is promoted to admin if none is left, and `groups.created_by` is handed to them if it named the departing account.
2. Only once every membership is settled does it delete the `user` row itself. Everything else follows the ordinary cascades: profile, wishes (and the wishes' own bookings, since `reservations.list_owner_id` cascades even though `reservations.wish_id` merely nulls), bookings the account held elsewhere, sessions.

`DeleteAccount` (`src/components/profile/delete-account.tsx`) sits in the settings section below sign-out, behind a destructive `Dialog` (`account.deleteTitle` / `.deleteBody` / `.deleteConfirm`). On success, `deleteAccountAction` redirects to `/` — the session row is cascaded away with the user, so the stale cookie resolves to "no session" on the very next request without an explicit sign-out call.

## `/access-denied` — deliberately unwired

There is **no leak-free trigger** for a "no access" screen. A signed-in non-member opening a restricted `/w/<id>` has to get the exact same invalid-link screen a bad id gets — if it read any differently ("this wish exists but you can't see it" vs. "this link is wrong"), the screen itself would confirm the wish exists to someone it's hidden from, which is a leak on its own. `ServiceScreen`'s existing invalid-link branch already covers this case correctly by not distinguishing it. Revisit only if a genuinely leak-free signal for "you specifically lost access" turns up — none does today.
