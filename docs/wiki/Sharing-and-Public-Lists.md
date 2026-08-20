# Sharing & Public Lists

> Phase 7a. How a list becomes shareable and what each kind of viewer sees. Reservations and guest identity (the "Забронирую" button, surprise-safe booking) arrive in Phase 7b.

## Public routes

- **`/u/[nickname]`** — a person's public wishlist. The nickname resolves via `getProfileByNickname` (case-insensitive); an unknown nickname renders the friendly "invalid link" service screen (§6.10).
- **`/w/[id]`** — a single wish as a share target: image, title, price, description, "open in store", and a link back to the owner's full list.

## Who sees what

The route reads the viewer's session and picks the access-layer query accordingly:

| Viewer | Query | Notes |
|---|---|---|
| Owner opening their own `/u/nick` | `getWishesAsSeenBy(…, { anonymous: true })` | A preview of the public view — **never** `getVisibleWishes`, so reservations can't leak (invariant #1) |
| Logged-in friend | `getVisibleWishes(…, { userId })` | Sees everyone-wishes + any restricted wishes shared with them |
| Guest (no session) | `getVisibleWishes(…, { anonymous: true })` | Only `everyone`-visibility wishes; **no tab bar, no FAB** — a top banner + language switch + "create your own" instead |

`getVisibleWish(db, wishId, viewer)` applies the same visibility rules to a single wish (restricted-away or missing → the invalid-link screen).

## "Good to know" block

The public list shows the owner's public parameters — sizes (object), tastes (chips), and a red "please don't gift" list — collapsed under "Что важно знать". If all three are empty the block is omitted entirely. Owners edit these on `/profile` (`updatePublicParams`, server-sanitized: trimmed, de-duped, length- and count-capped).

## Share sheet

`ShareSheet` (bottom sheet) offers a copyable link and the native share sheet when available. For a wish whose visibility is restricted, it first shows a note before revealing the link — and the note tells the truth: the `/w/[id]` route enforces visibility, so **even with the direct link only the selected audience can open it** (anyone else gets the invalid-link screen). Sharing a restricted wish is safe; the sheet just sets expectations.

## Link previews in messengers

Every shareable URL publishes both Open Graph and Twitter Card metadata. The
root page uses a branded 1200×630 Paper Ledger image, a localized description,
and an absolute URL based on `NEXT_PUBLIC_APP_URL`, so Telegram, WhatsApp,
Slack, Discord, iMessage, and other crawlers can render a large preview.

- `/u/[nickname]` uses the owner's display name and a re-hosted avatar when one
  exists; otherwise it falls back to the branded image.
- `/w/[id]` uses the public wish title, description, and re-hosted product image;
  a wish without an image falls back to the branded image.
- Unknown, deleted, or anonymously restricted links publish only generic Wishka
  metadata. The fallback never confirms that a private resource exists.

No preview field is derived from reservations. Public list and wish routes also
remain `noindex`; messenger cards are for recipients of the link, not search
discovery. Some messengers cache previews by the exact URL, so after a metadata
change the same link may need their cache refresh tool or a one-off query string
for immediate verification.

## App navigation note

The bottom tab bar is rendered by `AppTabBar` (a client component that owns the Lucide icons and i18n labels). Server Components must use `AppTabBar`, never the generic `ui/TabBar` with inline `icon:` props — passing an icon **function** across the RSC boundary throws ("Functions cannot be passed directly to Client Components"). Guests never see the tab bar at all.
