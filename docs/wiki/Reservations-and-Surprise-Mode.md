# Reservations and Surprise Mode

> Phase 7b. How a booking is taken, released, and outlives the wish it was made on — and how the owner is kept out of all of it, by construction rather than by convention.

## The surprise invariant

**The list owner must never see, or be able to infer, reservations of their own wishes** (product invariant #1). This is not a UI rule — it is enforced at the data-access layer, where leaking is meant to be impossible rather than merely avoided:

- `src/db/access/mutations.ts` and `src/db/access/owner.ts` are the only modules allowed to serve owner-facing reads and writes, and both are covered by source-guard tests that assert the module text never mentions the `reservations` table. The owner's DTO (`OwnerWish`) has no reservation-derived field to begin with — there is nothing to accidentally select.
- `src/lib/viewer.ts` (`resolveViewer`/`resolveReserver`) is the one place that decides *who is asking* — session user, guest cookie, or anonymous — and `src/db/access/viewer.ts` is the one place that joins wish visibility against `reservations` to produce a *non-owner* `reservationStatus: "free" | "reserved" | "reserved_by_you"`. No other module does that join.
- Owner-triggered actions that must have a side effect on bookings — delete, and (once wired) edit/mark-gifted — live in `src/db/access/wish-lifecycle.ts`, not in `mutations.ts`/`owner.ts`. `deleteWishAsOwner` runs `orphanActiveReservations` and `deleteWish` unconditionally inside one transaction, in the same order, whether or not a reservation exists, and returns exactly the boolean `deleteWish` already returned. A test asserts the return value and the observable owner-side shape are byte-identical with and without a booking — the owner cannot distinguish a booked wish from an unbooked one by anything the app tells them.
- `getReservationNotificationTarget` (`src/db/access/wish-lifecycle.ts`) is the only function that reads *who* holds a booking (name, email, locale, guest token). It is documented and used as **server-side only, consumed exclusively inside `after()`** — the post-response email dispatch in `src/app/wishes/actions.ts` and `src/app/reserve/actions.ts`. Its result is never part of a server action's return value, never logged, never rendered.

Because of this split, "does the surprise invariant hold" reduces to: did anyone add a reservation-shaped field to `OwnerWish`, or a reservations query to `mutations.ts`/`owner.ts`? Both are caught by the source-guard tests, so a regression fails CI rather than shipping.

### The boundary: this protects the *authenticated owner*

The invariant is enforced for the owner **as an authenticated session**. Every ownership short-circuit keys off `viewer.userId === wish.ownerId`, and an owner reading their own list (`/` and their own `/u/<nick>`) never joins reservations at all.

What it deliberately does **not** do is hide reservations from a determined owner who *stops being the owner from the app's point of view*. A public list shows `«Забронировано»` badges to every non-owner viewer — that is the whole point of the guest-facing surface — and an owner who opens their own list signed out (or in a private window) is, to the server, just another anonymous viewer. There is no way to show reserved badges to guests while hiding them from a signed-out owner, because the two are indistinguishable. This is inherent to "public list + visible reservation badges", not a defect in the data layer.

Two consequences worth stating plainly, so a future change does not assume protection that isn't there:

- The signed-out owner can read `reservationStatus` on their own wishes via `/u/<nick>` and `/w/<id>`, and the `merge` prompt count excludes own-list rows precisely so the *signed-in* owner never infers a booking from a number.
- A guest may reserve the list owner's own wish (only a *user* reserver is refused as `not_found` by `reserveWish`), so a signed-out owner acting as a guest could probe a single wish. Blocking guests from the owner's wishes would break normal booking, so this is left as the same signed-out-owner boundary.

If stronger protection is ever required, the fix is a product change — gate `reservationStatus` behind a session so guests see everything as `free` until they book — not a data-layer tweak.

## Reservation states

`reservations.state`: `active`, `cancelled`, `orphaned`, `fulfilled` (reserved for later use, currently unused).

- **active** — the current holder of the one slot a wish can have.
- **cancelled** — released, by the reserver (`cancelReservation`/`dismissReservation`) or by a guest→account merge that folded it into a duplicate.
- **orphaned** — the wish it pointed to is gone; set by `orphanActiveReservations` when an owner deletes a wish that had an active booking. `wish_id` on an orphaned row is left as-is (the FK is `onDelete: "set null"`, so a row can also end up with `wish_id = NULL` if the delete path is ever reached without going through `orphanActiveReservations` first — `getMyReservations` treats an `active` row with no matching wish the same as `orphaned`, as a defensive fallback).
- **fulfilled** — modeled in the schema for a future "actually bought" signal; nothing sets it yet.

### One active reservation per wish (the race guard)

`reservations` has a partial unique index on `wish_id` where `state = 'active'`. `reserveWish` does not read-then-check-then-write; it simply inserts and lets Postgres arbitrate. The loser of a concurrent double-booking gets a unique-violation, which `reserveWish` turns into `{ ok: false, reason: "already_reserved" }`. This is what makes the "уже забронировали" conflict sheet correct even when two people tap "Забронирую" within the same second — there is no window between a check and a write for a second booking to sneak through.

`reserveWish` also collapses two other failure modes into the *same* `not_found` result as a genuinely missing wish, on purpose:

- the wish is not visible to this viewer (`visibleTo`, see [Data Model](Data-Model)),
- the wish belongs to the reserver themself.

Never a distinct reason code — an owner probing `reserveWishAction` on their own wish must not be able to tell "not visible" apart from "you can't book your own", and a stranger must not be able to tell "wrong id" apart from "you own this". `already_reserved` is the only reason that ever confirms a wish exists and is real.

## Reservation snapshots — surviving the wish underneath it

At reserve time, `reserveWish` copies the wish's `title`, `url`, `priceType`/`priceMin`/`priceMax`/`currency`, and the reserver's UI `locale` onto the reservation row, plus `listOwnerId` (denormalized `wishes.ownerId`). These columns are immutable after insert. Three things depend on this snapshot surviving independently of the live wish:

1. **A deleted wish still has a nameable booking.** `orphanActiveReservations` only ever changes `state`/`orphanedAt` — the snapshot is what lets "Мои брони" say *what* was deleted, and what a "wish deleted" email names in its subject.
2. **"Мои брони" diffing.** `getMyReservations` (`src/db/access/my-reservations.ts`) compares the snapshot against the live wish's current title/url/price fields and reports a `state: "changed"` card with a `changedFields: ("title" | "price" | "url")[]` list. Deliberately **no visibility re-check** here — the reserver already saw the wish when they booked it, and if the owner later narrows its audience the reservation still stands (see [Data Model](Data-Model) → Visibility rules), so the holder must still be able to see what they committed to and release it. Only fields already shown on a wish card are exposed this way — nothing new.
3. **Owner-changed / owner-deleted emails carry the right title even after the row is edited or gone**, without a second read of the (possibly already-mutated) wish.

State precedence in `getMyReservations`: a live wish with `status: "gifted"` reports `given` (settled either way, wins over a diff); otherwise a snapshot/live mismatch reports `changed` with the specific fields; a missing wish or an `orphaned` row reports `deleted`; otherwise `active`.

## Deleting a wish that's booked

`deleteWishAsOwner(db, ownerId, wishId)` (`src/db/access/wish-lifecycle.ts`):

```
tx.transaction:
  orphanActiveReservations(tx, wishId, ownerId)   // unconditional, no-op if nothing active
  deleteWish(tx, ownerId, wishId)                 // the existing owner-only delete
  → false if deleteWish returned false: roll back the orphan too
```

Both statements run every time, in the same order, regardless of whether a booking exists — that is the mechanism behind "the owner sees zero difference." The ownership check for orphaning lives inside the `UPDATE`'s `WHERE … EXISTS (…owner_id = $ownerId)` clause rather than a prior `SELECT`, so there's one round trip either way, not a branch.

## The email matrix

All four emails are plain functions in `src/lib/email/reservation-emails.ts` (params in, no DB access) built on a single shared template (`src/lib/email/template.ts` — Paper Ledger table-based HTML, light-theme tokens, all interpolated content HTML-escaped) and copy in `src/lib/email/copy.ts` (RU + EN, kept separate from `messages/*.json` since these render outside any request's locale context). Every sender swallows its own errors — a lost email must never fail or slow down the request it's attached to — and every dispatch happens inside Next's `after()`, strictly post-response.

| Event | Sender | Trigger site | To | Tone |
|---|---|---|---|---|
| Guest booking confirmed (email given at booking or added later) | `sendGuestBookingConfirmation` | `src/app/reserve/actions.ts` (`reserveAsGuestAction`, `saveGuestEmailAction`) | the guest's email | вы-form, includes the `/g/<token>` manage-booking link |
| Owner edited a booked wish's title/url/price | `sendReservedWishChanged` | `src/app/wishes/actions.ts` (`updateWishAction`, only when `materialChanges` is non-empty) | reservation holder (user or guest) | matches the holder's stored `locale` |
| Owner deleted a booked wish | `sendReservedWishDeleted` | `src/app/wishes/actions.ts` (`deleteWishAction`; **not** sent from `destroyWishAction`, the archive's permanent-delete — that wish was already resolved for the reserver) | reservation holder | matches stored `locale` |
| Owner marked a booked wish as gifted | `sendGiftGiven` | `src/app/wishes/actions.ts` (`markGiftedAction`) | reservation holder | ты-form, "🎉" |

Every trigger site reads its `NotificationTarget` via `getReservationNotificationTarget(db, wishId)` — the *active* reservation on that wish, joined to `user` or `guest_identities` depending on which side of the reserver check constraint is populated — and only ever inside `after()`. `updateWishAction` and `deleteWishAction` both read the target relative to the mutation (before for delete, after for update, since orphaning doesn't touch the row's identity) so the right holder is notified even though the wish is changing under it.
