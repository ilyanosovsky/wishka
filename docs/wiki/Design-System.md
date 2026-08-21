# Design System — Paper Ledger

> Component kit in `src/components/ui/`. Visual source of truth: `design/uploads/tokens.css` + `design/Wishka Mini-System.dc.html`. Live playground: `/dev/ui` (dev builds only), renders everything in both themes.

## Principles

- **Everything is square** (`--radius: 0`); circles only for avatars and status dots (`rounded-round`).
- Three typefaces with fixed roles: Newsreader/Literata serif — names and headings; Inter — UI text; JetBrains Mono — numbers, prices, meta, labels.
- Tokens are CSS variables (`src/styles/tokens.css`), themed via `data-theme`; components use Tailwind utilities mapped in `globals.css` — **no raw hex in components**.
- Tap targets ≥ 44px; AA contrast in both themes.
- Generic components take all text via props; only product components (WishCard) use i18n directly.
- Icons: lucide-react, `strokeWidth={2.4}`, no fill.

## Components

| Component | File | Notes |
|---|---|---|
| Button | `button.tsx` | default / primary / danger / ghost, loading spinner |
| Field | `field.tsx` | focus, error, locked, parsed-link variants |
| Tabs (segmented) | `tabs.tsx` | ink-active (filters) and accent-active (price mode) fills, count badges |
| Chips | `chip.tsx` | FilterChip, TagChip, NoGiftChip |
| Avatar | `avatar.tsx` | round + square masthead variant, stacked group with +N |
| TabBar | `tab-bar.tsx` | mobile bottom tabs; persistent left rail at `lg` |
| FAB | `fab.tsx` | square mobile action; labeled rail action at `lg` |
| Banners | `banner.tsx` | error / warning / success left-rule alerts |
| Skeleton | `skeleton.tsx` | shimmer + wish-card-shaped skeleton |
| BottomSheet | `bottom-sheet.tsx` | touch drawer below `lg`; centered desktop dialog; scrim + scroll lock |
| Dialog | `dialog.tsx` | destructive action = right + red; neutral variant for drafts |
| Toasts | `toast.tsx` | UndoToast (5s progress bar), InfoToast |
| Badges | `badges.tsx` | StatusBadge, DreamStamp, NullPill, PriorityFlag, VisibilityLockBadge |
| **WishCard** | `wish-card.tsx` | see below |
| OTP input | `../auth/otp-input.tsx` | 6 mono boxes, paste-friendly |

## WishCard — the state matrix

Discriminated union by `role`:

- `owner` — **the type does not accept reservation data at all**; a `@ts-expect-error` test keeps it that way (product invariant #1 at the component level). Optional `restrictedVisibility` lock badge.
- `viewer` — requires `reservationStatus`: `free` (badge) / `reserved` (dimmed, no CTA) / `reserved_by_you` (accent inset border).
- `archive` — grayscale, "Подарено" badge, date + optional "от {имя}" meta.

Cross-cutting modifiers: dream stamp, 3 priorities, price exact/range/none (nullpill), image ready/generating(shimmer)/failed(retry+upload)/none(category placeholder), 2-line title clamp, any currency.

## Responsive layout

The 375px mobile composition remains the baseline. Responsive changes begin at Tailwind's `lg` breakpoint (1024px); there is no tablet-only redesign between those modes.

- `AppTabBar` supplies the branded app navigation marker. `globals.css` reserves the 272px rail only on pages that render that marker, so public and focused flows stay centered without a second shell.
- Primary list surfaces are bounded at `max-w-6xl`: two mobile columns become three at `lg` and four at `xl`. People and Profile use `max-w-5xl`; long forms use `max-w-3xl`.
- Own and shared wish details use one flow on mobile and an image/content split on desktop. Profile keeps its mobile document order, then places public parameters beside a sticky partner/settings column at `lg`.
- `BottomSheet` keeps the mobile drawer markup and accessibility behavior. Desktop CSS changes only its position, width and overflow, producing a centered modal without duplicating state or focus logic.
- Desktop additions reuse the Paper Ledger tokens, square radius rule, one accent and existing type roles. Both color themes and both locales share the same responsive structure.

## Price formatting

`src/lib/price.ts` — `formatPrice()`: NBSP thousands, `–` for ranges, symbol from `src/lib/currencies.ts` (falls back to the code); `null` → NullPill. No conversion anywhere (product decision).
