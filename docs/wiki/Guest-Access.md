# Guest Access

> Phase 7b. How someone reserves a gift without creating a Wishka account, and how that identity later folds into one if they sign up.

## Identity model

A guest is deliberately thin: a display name, an optional email, and one credential — a bearer token. There is no password and nothing to recover; losing the token without an email on file simply loses the ability to manage that booking.

- **`guest_identities`** (`src/db/schema.ts`, access in `src/db/access/guest-identities.ts`): `id`, `token` (32 random bytes, `node:crypto` `randomBytes`, base64url — cookie- and URL-safe), `name` (≤100 chars, trimmed, required), `email` (optional, ≤254 chars, validated by a deliberately loose regex — the real verdict comes from the mail provider, not from the app rejecting a valid-looking address).
- **The device cookie** — `wishka-guest` (`src/lib/guest.ts`, `GUEST_COOKIE`): httpOnly, `sameSite: "lax"`, `secure` in production, `path: "/"`, max-age 400 days (the ceiling Chrome allows). It carries the raw token. Because it's httpOnly, client-side JS never sees it — the token only ever travels in this cookie or in a manage-booking email link.
- **Resolution precedence** — `resolveViewer`/`resolveReserver` (`src/lib/viewer.ts`): a Better Auth session wins over the guest cookie; the guest cookie wins over anonymous. This is the *only* place that decides identity, so it can't drift between the reserve panel, "My bookings", and the manage-booking route.

A signed-in user who also carries a guest cookie (e.g. they booked as a guest, then logged in on the same device) is **deliberately not merged automatically** — their guest bookings keep showing as guest bookings until they accept the merge prompt (see below). That gap is what makes the prompt worth showing.

## Booking as a guest

`reserveAsGuestAction(wishId, { name, email? })` (`src/app/reserve/actions.ts`):

1. If the request already carries an identity (a session, or an existing guest cookie — a second tab, a stale sheet), it reserves as that identity instead of minting a new guest — no duplicate identities from re-submitting the form.
2. Otherwise: `createGuestIdentity` inserts the row, `setGuestCookie` writes the cookie **immediately**, then `reserveWish` is attempted. The cookie is set before the reservation succeeds/fails on purpose — even if this booking loses a race (`already_reserved`), the guest doesn't have to introduce themselves again on the next wish.
3. If an email was given, a confirmation is queued in `after()` (`sendGuestBookingConfirmation`) carrying the manage-booking link.

If the guest skipped the email field, `saveGuestEmailAction(wishId, email)` fills it in later (reads the token from the cookie, `setGuestEmail`, then re-sends the confirmation — the email *is* what carries the manage-booking link, so saving one without resending it would leave the guest with no way to reach it).

## The manage-booking link — `/g/<token>?next=<path>`

`src/app/g/[token]/route.ts`. Every guest email's CTA points here. Behavior is intentionally uninformative about whether the token is valid:

- **Valid token** → sets the `wishka-guest` cookie for this device, then redirects to `next`.
- **Unknown/expired token** → redirects to `next` anyway, just without setting the cookie — the visitor lands on the wish as a plain anonymous guest. The route never renders an error and never confirms or denies that a token exists, so the link can't be used to probe for live tokens.

`next` is passed through `sanitizeNextPath` (`src/lib/next-param.ts`) and constrained to an internal path — never an open redirect.

### Other-device behavior

Opening a reserved wish's page or the manage-booking link on a device that has never held the `wishka-guest` cookie for that guest shows the wish as booked by *someone*, not by *you* — the UI cannot tell "this device is that guest" apart from "someone else booked it" without the cookie. The manage-booking email link is the way to re-establish that on a new device; there is no other recovery path (no password, nothing to reset).

## Guest → account merge

When a signed-in user's browser also carries a live guest cookie, `getGuestMergeCountAction` reports how many of that guest's bookings are still live, and `mergeGuestReservationsAction` performs the merge:

`mergeGuestIntoUser(db, guestId, userId)` (`src/db/access/guest-identities.ts`, one transaction):

1. **Bookings the guest made on the *same user's own list*** (they were browsing their own wishlist logged out, or a friend used their device) are **cancelled, not transferred**. `reserveWish` already forbids an owner holding a reservation on their own wish, and transferring would both violate that and hand the owner a reservation row of their own — the surprise invariant running backwards, one level up.
2. **Every other live reservation** (`state` in `active`/`orphaned`) is reassigned: `reserverUserId = userId`, `guestId = NULL`.
3. Returns the count from step 2 only (what actually moved). Idempotent — a second call finds nothing left in a live state tied to that guest and returns 0.

No unique-index conflict is possible during the transfer: the partial unique index allows at most one `active` row per wish, so if the guest already holds it, the signed-in user cannot hold a second one on the same wish.

`mergeGuestReservationsAction` (`src/app/reserve/actions.ts`) requires a session, reads the guest cookie, calls the merge, and **clears the guest cookie either way** — including when the token was stale/unknown (nothing to merge, but the dead cookie is dropped so the merge prompt stops asking). `revalidatePath("/people")` refreshes "My bookings" afterward.

## Privacy notes — what a guest token can and cannot do

A guest token is a bearer credential scoped to exactly one thing: managing that guest's own reservations (view, release, add/update the email on file). It cannot:

- see the wish owner's other data, their profile settings, or any other visitor's reservations,
- read or infer anything about the wish owner having "seen" the booking — the surprise invariant applies identically to guest and account reservers,
- be used to sign in as a Wishka account, or to claim reservations made under a *different* guest token.

Because the token lives only in an httpOnly cookie and in email links, it is never exposed to page JavaScript and is not logged in any server action's return value.
