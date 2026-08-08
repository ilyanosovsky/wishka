# Wishka — Implementation Plan

> **Living document.** Every PR updates the status of the step(s) it advances. Statuses: ⬜ todo · 🔵 in progress · ✅ done · ⏸ blocked.
> Ground rules live in [CLAUDE.md](CLAUDE.md). UX source of truth: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) + `design/` mockups (Paper Ledger, final synthesis "3a–3c").
> Model policy: Fable orchestrates; complex steps → Opus subagents; small/mechanical steps → Sonnet subagents.

## Status overview

| Phase | Scope | PR | Status |
|---|---|---|---|
| 0 | Bootstrap: docs, license, repo, protection | — (direct, pre-protection) | ✅ done |
| 1 | Scaffold: Next.js, tokens, themes, i18n, CI | PR #2 | ✅ done |
| 2 | Database (Railway PG + Drizzle), Better Auth, onboarding | PR #3 | ✅ done |
| 3 | Design system: components + wish card matrix | PR #4 | ✅ done |
| 4 | My list: CRUD, filters, detail, archive | PR #5 | ✅ done |
| 5 | Add by URL: parsing pipeline + image re-hosting | PR #6 | ✅ done |
| 6 | AI assists: text-to-wish, suggestions, image gen, quotas | — | ⬜ |
| 7 | Sharing & reservations: public lists, guests, surprise mode | 7a PR #7 · 7b PR #8 | ✅ done |
| 8 | Groups, partner, visibility, view-as | 8a this branch · 8b next | 🔵 |
| 9 | Polish & launch: i18n/dark audit, a11y, prod config | — | ⬜ |

Design-debt items carried from mockup analysis are folded into phases 1 and 3 (see "Design deviations to resolve" below).

---

## Phase 0 — Bootstrap ✅

Repo initialized with docs (VISION, DESIGN_BRIEF, this plan), CLAUDE.md, README, MIT license, .env.example, PR template, wiki sync workflow (`docs/wiki/` → GitHub Wiki on merge), `design/` mockups. `main` protected: PRs only, linear history, no force pushes. *Everything after this phase goes through PRs.*

## Phase 1 — Scaffold & tooling (PR #2)

**Goal:** empty but deployable app with the full quality gate.

- ✅ `create-next-app` (TypeScript, App Router, `src/` dir + `@/*` alias — documented in wiki), strict tsconfig.
- ✅ Tailwind v4 wired to **CSS variables from `design/uploads/tokens.css`** (var names kept, mapped via `@theme inline`). `--font-serif` fixed to Newsreader→Literata→Georgia (Cyrillic).
- ✅ Dark theme `[data-theme="dark"]` + system media fallback authored in `src/styles/tokens.css`; missing dark tokens derived (zebra, badge families, shadows); minted `--toast-accent`, `--scrim`. 3-way Light/Dark/System toggle, persisted, no-flash inline script. Verified: computed `--bg/--ink/--accent` correct in both themes.
- ✅ Fonts via `next/font` (Newsreader, Literata, Inter, JetBrains Mono; Cyrillic subsets where available).
- ✅ next-intl **without locale routing** (cookie + browser-language default), RU+EN catalogs, locale switcher; catalog key-parity enforced by test.
- ✅ ESLint (`next/core-web-vitals`, `design/` excluded) + Prettier + `npm run typecheck`.
- ✅ Vitest + @testing-library/react + happy-dom; 8 tests (messages parity, theme utils).
- ✅ CI workflow `.github/workflows/ci.yml`: lint → typecheck → test (job `ci`). ⬜ After merge: add `ci` to required status checks on `main`.
- ⬜ Vercel project connected (user action: import repo at vercel.com/new; preview deploys on PRs).
- **Wiki:** `Local-Setup.md`, `Architecture.md` — done in this PR. **Model:** done inline (Fable), theme system hand-authored.

## Phase 2 — Database, auth, onboarding (PR #3)

> Stack revised 07.08.2026 (Supabase → Railway/Better Auth, see VISION.md §5.1): Supabase free tier caps at 2 active projects per account; Railway Hobby is already paid with unused credits.

**Goal:** login works end-to-end; schema + data-access layer enforce the product's privacy core.

- ✅ Railway Postgres provisioned by Ilya; migrations applied. ⚠️ Backups unavailable on Railway Hobby tier — accepted for now; revisit before launch (Phase 9): pg_dump cron or tier upgrade.
- ✅ Drizzle ORM + drizzle-kit migrations in `drizzle/`; typed schema (14 tables).
- ✅ Schema v1: `profiles` (nickname unique, base_currency, partner_id, sizes jsonb, tastes jsonb, no_gift jsonb), `wishes` (type, title, url, image_key, description, price exact/range + currency, priority, is_dream, category, notes, visibility mode, status, archived fields), `wish_visibility` (wish ↔ group/person), `groups`, `group_members` (role), `group_invites`, `reservations` (wish, reserver profile **or** guest identity, state), `guest_identities` (token, email), `parsed_url_cache`, `ai_usage` + Better Auth tables (user/session/account/verification via Drizzle adapter).
- ✅ **Data-access layer (`src/db/access/`) — the surprise invariant:** DB is server-only; owner-facing query builders **cannot select reservation data by construction** (viewer-role-scoped modules + DTOs). Visibility rules (everyone / groups / persons / partner) live in the same layer. Vitest proves both against in-process PGlite running the real migrations (no docker needed) — 32 DB tests.
- ✅ Better Auth: Google OAuth + email OTP (6-digit via Resend), sessions in Postgres, server-side route guards.
- ✅ Login + code screens with §6.1 states (errors, resend timer, lockout); mini-onboarding (name, avatar client-side downscale + upload, nickname live availability, base currency); skippable.
- ✅ `src/lib/storage/` adapter (StoragePort) + UploadThing implementation; avatar upload route with session authz.
- **Wiki:** `Data-Model.md`, update `Local-Setup.md` (Railway, Google OAuth, Resend, UploadThing). **Model:** Opus (schema/data-access/auth), Sonnet (screens).

## Phase 3 — Design system components (next PR)

**Goal:** the Paper Ledger kit, so feature phases assemble instead of invent.

- ✅ Base: Button (primary/danger/loading ≥44px), Field (focus/error/locked/parsed-link), segmented Tabs (ink-active and accent-active variants), Chips, BottomSheet (square, drag-handle, up-shadow), Dialog (+destructive-right rule), Toast (undo with 5s progress bar), Avatar (round) + square masthead avatar, TabBar (3 tabs, 2px top rule), square FAB, alert banners, OTP input, skeleton/shimmer.
- ✅ Badges: status (Свободно / Забронировано / Забронировано вами / Подарено), rotated "Мечта" stamp, nullpill "нет цены", priority flag triangle, visibility lock badge.
- ✅ **WishCard with the full state matrix** (role × status × modifiers: dream, priority, restricted visibility, no-image category placeholder, generating shimmer, generation failed, 2-line clamp, price range, no price, any currency). Owner variant renders **identically** with or without reservations — test asserts the component API doesn't even accept reservation data in owner mode.
- ✅ Icons: lucide-react, strokeWidth ≈2.4, fill none.
- ✅ `/dev/ui` playground route (dev-only) showing every component in both themes.
- **Wiki:** `Design-System.md`. **Model:** Opus (WishCard, BottomSheet), Sonnet (rest).

## Phase 4 — My list & wish CRUD (next PR)

**Goal:** the owner's core loop without parsing/AI.

- ✅ My list screen: archive entry, search, filter chips + sort, **card view (3a) / ledger list view (3b) switcher**, 2-col grid; states: skeleton (route group), offline banner, empty, filtered-empty, error boundary. Deferred: share button (hidden until public lists, Phase 7), pull-to-refresh + infinite scroll (list loads fully at current scale — revisit if lists grow).
- ✅ Manual add/edit form (§6.3 step 3, sans AI): type tabs, photo upload (proportional client downscale + our-CDN-only server validation), price exact/range/none + currency sheet with recents, priority + dream toggle, category, notes, visibility stub, per-user draft persistence + save-draft dialog, i18n-mapped server errors.
- ✅ Own wish detail; "Уже подарили" sheet (free text — **never from reservations**); delete with 5s undo (commits on unmount — reviewed); archive screen (year groups, restore, permanent delete). URL scheme validation (http/https only) added after review.
- **Wiki:** update `Architecture.md`. **Model:** Opus (list orchestration/drafts), Sonnet (archive, forms).

## Phase 5 — Add by URL: parsing pipeline (next PR)

**Goal:** paste a link → card assembles; failure is a calm, first-class path.

- ✅ Parsing pipeline (`src/lib/parse/`, via `parseUrlAction`): **L0** fetch + open-graph-scraper (OG+JSON-LD, real UA, 8s timeout, challenge-page detection) → **L1** LLM extraction over cleaned HTML (`OPENAI_MODEL_TEXT`, structured outputs) → **L2** Jina Reader (`r.jina.ai`) → **L3** Firecrawl (free 1000/mo) → give up gracefully. Stop-list (Amazon-class) → manual immediately. Cache results in `parsed_url_cache` (one parse per URL globally).
- ✅ **Image re-hosting:** server-side fetch, content-type/size validation, store copy via `lib/storage/` adapter (UploadThing UTApi; swappable to Railway Buckets); `next/image` remotePatterns = our storage host only.
- ✅ Add-by-URL UI: clipboard suggestion, parsing states (fast <3s / slow >5s with escape hatch / partial with highlights / failed calm / stop-list / duplicate detection).
- ✅ Tests: pipeline layering + fail detection on fixture HTML (Shopify-like OK, challenge pages, empty shells); no live network in CI.
- **Wiki:** `Parsing-Pipeline.md`. **Model:** Opus (pipeline), Sonnet (UI states).

## Phase 6 — AI assists & quotas

**Goal:** AI fills gaps — on explicit tap, within budget.

- ✅ "Добавь словами": free text → structured wish draft (type, category, price range, description) via `draftWishFromTextAction` (`src/lib/ai/` prompts + hostile-output hardening in `draft.ts`); third entry option in AddWishSheet, handed to the form through the same sessionStorage handoff parsing uses (`wishka-ai-draft` → `/wishes/new?ai=1`).
- ✅ Description & price suggestions in the form: candidate card with «Принять»/«Скрыть»; every AI error/quota state renders inline and never blocks saving (invariant #3 covered by a submit-never-blocked regression test).
- ✅ Image generation (`OPENAI_MODEL_IMAGE`, low, 1024×1024): armed in the form («Сгенерируем после сохранения»), started on save; the async job runs in `after()` with the `wishes` row as job state (`imageStatus`), finish updates only rows still `generating` (owner upload during the job wins). Card shows «Рисуем…» → poller + toast «Картинка готова» / failed state with retry + upload (also on wish detail). Retry allowed from `failed` and stale `generating`.
- ✅ Per-user daily quotas in `ai_usage` (server-enforced, atomic upsert like parse): `text` 30/day shared by draft+suggestions, `image` 10/day; ICU-plural counters «Осталось N», exhausted states with brief copy; graceful no-API-key degradation (affordances hidden, actions answer `unavailable`).
- ✅ Tests: quota accounting (pools/boundaries/rollover), prompt-builder units, image-job state machine incl. clobber guard, component flows.
- **Wiki:** ✅ `AI-Features.md` (+ costs note). **Model:** Opus (async job + quotas), Sonnet (form UI).

## Phase 7 — Sharing, guests, reservations (split: 7a public lists, 7b reservations)

**Goal:** the reason Wishka exists — sharing + surprise-safe reservations.

**7a:**
- ✅ Public profile+list `/u/[nickname]` (header, "Что важно знать", grid with badges, "Только свободные" filter, empty states); guest banner (RU/EN switch, "Создать свой"); single-wish share `/w/[id]`; share sheet (copy link, native share fallback, restricted-visibility warning); no tab bar/FAB for guests. Fixed a Phase-4 RSC bug (icons across the server/client boundary) via AppTabBar.
- ✅ Profile screen (§6.6): public-status line, sizes/tastes/no-gift editor (server-sanitized), settings (language, theme, currency, logout). Partner + view-as + delete-account deferred to Phase 8/later.

**7b:**
- ✅ Reservation lifecycle: `reserveWish`/`cancelReservation`/`dismissReservation`/`orphanActiveReservations` (`src/db/access/reservations.ts`), race conflict via the partial unique index (`already_reserved`), owner-reserve refused as `not_found`, `dismissReservation` releases orphaned rows by reservation id. `deleteWishAsOwner` (`src/db/access/wish-lifecycle.ts`) orphans + deletes in one transaction, byte-identical result whether or not a booking exists. Reserve/cancel/dismiss server actions in `src/app/reserve/actions.ts`. UI on `/w/[id]`: `ReservePanel` + status badge (`src/components/reserve/`) — confirm dialog («Никому не скажем 😉»), unreserve with undo toast, conflict sheet («Увы, это уже забронировали»), gone dialog («Владелец удалил это желание»), owner sees neither badge nor panel.
- ✅ Guest identity: device cookie `wishka-guest` (`src/lib/guest.ts`) + `guest_identities` (name + optional email, bearer token, `src/db/access/guest-identities.ts`); `resolveViewer`/`resolveReserver` (`src/lib/viewer.ts`) unify session vs. guest cookie precedence; manage-booking link `/g/[token]` (`src/app/g/[token]/route.ts`); guest→account merge (`mergeGuestIntoUser`, cancels own-list bookings instead of transferring, idempotent) wired to `mergeGuestReservationsAction`. UI: guest bottom sheet («Как вас записать?») with success screen + "leave an email" prompt (`src/components/reserve/guest-form-sheet.tsx`), other-device hint, merge-prompt banner on `/u/[nickname]` and `/people` (`src/components/reservations/merge-banner.tsx`).
- ✅ "Мои брони": `getMyReservations` (`src/db/access/my-reservations.ts`) derives active/changed(+fields)/deleted/given from the reservation snapshot vs. the live wish, no visibility re-check (by design — see wiki). `/people` is now Групп/Мои брони tabs (`src/components/reservations/`): reservation cards with owner avatar, state chips, unreserve/dismiss actions, recently-viewed lists (localStorage, `src/lib/recent-lists.ts`), empty state. Emails wired into owner actions (`src/app/wishes/actions.ts`) via `after()`: `sendGuestBookingConfirmation`, `sendReservedWishChanged`, `sendReservedWishDeleted`, `sendGiftGiven` (`src/lib/email/reservation-emails.ts` + `copy.ts` + Paper Ledger `template.ts`).
- ✅ Service screens (§6.10) delivered so far: `/session-expired`, `/login?next=<path>` return-path support (`sanitizeNextPath`, incl. onboarding pass-through), invalid-link screen (`ServiceScreen` on `/w/[id]`, `/u/[nickname]`). "Expired invite" delivered in Phase 8a (`/invite/[token]`). "No access" (visibility narrowed after the fact) resolved in Phase 8b as a deliberate non-delivery, not a deferral — see the 8b note below.
- **Wiki:** ✅ `Reservations-and-Surprise-Mode.md`, `Guest-Access.md`. **Model:** Opus (both halves — this is the crown jewel), Sonnet (emails, service screens).

## Phase 8 — Groups, partner, visibility (split: 8a groups + invites, 8b partner + "Кому видно" + view-as)

**Goal:** the social fabric + real per-wish privacy.

**8a:**
- ✅ Groups data access (`src/db/access/groups.ts`): `createGroup`/`getMyGroups`/`getGroupDetail`/`updateGroup`/`leaveGroup`/`removeMember`/`deleteGroup`/`isGroupMember` — non-member reads of a group collapse to the same `null` as a missing one (never a distinct "forbidden" oracle); `createdBy` is handed on whenever the creator leaves *or is removed* and the group survives, so the group can't be taken down later by that account's deletion; `leaveGroup` promotes the longest-tenured member when no admin remains. `deleteGroup` cleans up the group's `wish_visibility` rows first, since `subject_id` has no FK to cascade them. All four membership mutations serialize on `select … from groups … for update`.
- ✅ **Removing a member revokes the group's live invite links** — otherwise eviction is undoable: the invite link is one reusable token any member can read, so the removed person could re-join in a tap and get every group-restricted wish back, making the confirmation copy false. Covered by an end-to-end regression test.
- ✅ Invites data access (`src/db/access/group-invites.ts`): `getOrCreateActiveInvite`/`lookupInvite`/`acceptInvite`/`revokeGroupInvites` — the invite row id doubles as the token, 14-day TTL, reused while live, idempotent accept (a second accept, or a unique-violation race from a double-tap, both resolve to `alreadyMember: true` rather than an error). Revocation only touches live links, so an expired one keeps reading as `expired`.
- ✅ `/people` Groups tab: empty state (create + "у меня есть приглашение" hint), group list, create sheet (name/emoji/color).
- ✅ `/groups/[id]`: member grid (admin/you badges, per-member visible-wishes link gated by `visibleTo`), «Пригласить» next to the members (share sheet opens straight after creating a group), meatball menu (invite link → ShareSheet, rename/appearance, leave, admin-only delete/remove-member and «Отозвать ссылку»), v2 "Secret Santa" placeholder card.
- ✅ `/invite/[token]` acceptance flow — all five states (`expired`/`revoked` and `not_found` as `ServiceScreen` dead ends, valid+no-session with a `loginHrefWithNext` sign-in CTA, valid+already-member as a dead end back to the group, valid+joinable as the one interactive accept step).
- ✅ `ShareSheet` gains `kind: "group"` for the invite-link share (copy-link/native-share only — a group invite is never `restricted`).
- ⬜ **Deferred, not a gap:** an email-invite UI. The brief's group flow is "create → copy link → share sheet" and never collects an address anywhere in it; inventing an email-collection step here would be UX not in the brief. If a future phase wants it, it needs its own design pass first.
- **Wiki:** ✅ `Groups-and-Visibility.md`. **Model:** Opus (data-access + visibility integration), Sonnet (group CRUD UI, invite screen, docs).

**8b:**
- ✅ Data access (`src/db/access/visibility.ts`): `getAudienceCandidates`/`getWishAudience`/`setWishAudience`/`createWishWithAudience`/`isWishVisibleTo`. `visibleTo`'s `Viewer` union gains `{ groupId }` — "as any member of this group sees it", not a stand-in for one real member (which would also pick up that member's individual grants). `setWishAudience` validates server-side: every group must be one the owner is a member of, every person must share a group with the owner **or be the partner**, and an empty `restricted` audience is rejected (`empty_audience`) so the UI can't hide a wish by accident. No fourth "partner-only" mode — §6.3 defines three, the partner is just pinned first inside «Отдельным людям».
- ✅ `updateWishAsOwner` (`src/db/access/wish-lifecycle.ts`) gains an optional `audience` and now also returns `reserverLostAccess: boolean` — a **transition**, not a state: the visibility predicate is replayed for the captured reservation holder both *before* and *after* the write, and the flag is `visibleBefore && !visibleAfter`. Both probes run unconditionally, in the same transaction. A post-only check would keep firing the email on every later save of an already-restricted wish, and would blame the owner when the holder left the audience on their own. The owner-visible `result` is byte-identical whether or not narrowing cut a reserver off.
- ✅ Narrowing-after-reservation email: `sendReservedWishHidden` (`src/lib/email/reservation-emails.ts` + `copy.ts`) — the booking stays theirs, they just can't see the wish anymore. Dispatched from `src/app/wishes/actions.ts`'s `after()`, mutually exclusive with `sendReservedWishChanged`.
- ✅ «Кому видно» sheet (`src/components/wishes/visibility-sheet.tsx`), wired into `wish-form.tsx`: everyone / groups / people, zero-groups and zero-people empty states, `visibility.emptyAudience` guard, and a static (never conditional) `visibility.narrowNote` footnote — a note that only appeared when a booking existed would itself be an oracle.
- ✅ Partner (`src/db/access/profiles.ts`: `setPartner`/`clearPartner`) — refuses partnering yourself and refuses anyone who shares no group with the caller (the only relationship Wishka can vouch for). `PartnerBlock` (`src/components/profile/partner-block.tsx`) on `/profile`: pick-is-the-action, no separate save step, `InfoToast` confirms.
- ✅ "Посмотреть, как видят другие" (`src/components/profile/view-as-sheet.tsx`): guest/group/person lenses, navigates to `/u/<own nickname>?as=guest|group:<id>|user:<id>`. `/u/[nickname]/page.tsx` only honors `?as=` for the owner viewing their own page, validates the target (own group / a real candidate, else falls back to `guest`), and renders through `getWishesAsSeenBy` — never `getVisibleWishes` — so reservations can never surface in the preview.
- ✅ `deleteAccount` (`src/db/access/account.ts`): winds down every group membership through `leaveGroup`'s own succession rule first (never re-implemented), *then* deletes the `user` row, so `groups.created_by`'s cascade can never take a co-member's group down with the deleting account. `DeleteAccount` (`src/components/profile/delete-account.tsx`) is a destructive `Dialog` off the settings section; `deleteAccountAction` redirects to `/` on success (the stale session cookie resolves to no session on its own — no explicit sign-out call needed).
- ⬜ **Deliberate, not a gap:** `/access-denied` stays unwired. There is no leak-free trigger for it — a signed-in non-member opening a restricted `/w/<id>` has to get the *same* invalid-link screen as a bad id, or the screen would itself confirm the wish exists to someone it's hidden from. Revisit only if a genuinely leak-free signal for "you lost access" surfaces.
- **Wiki:** ✅ `Groups-and-Visibility.md` — "Who can see a wish" section added, grounded in the shipped code. **Model:** Opus (visibility+lifecycle integration), Sonnet (profile UI, docs).

## Phase 9 — Polish & launch (next PR)

- ⬜ EN localization pass on all screens (long-string stress test, plurals); dark-theme audit of every screen; a11y sweep (44px targets, AA contrast, focus states).
- ⬜ Empty/error state sweep vs DESIGN_BRIEF §6 checklist; email templates final pass.
- ⬜ Production config: Vercel env vars, Railway Postgres backups verified, Google OAuth prod redirect URIs, Resend domain, UploadThing prod app; deploy checklist in wiki.
- ⬜ README: screenshots, live demo link; `CONTRIBUTING.md` if community shows up.
- **Wiki:** `Deployment.md`. **Model:** Sonnet sweeps, Opus for anything structural that surfaces.

---

## Design deviations to resolve during implementation

From mockup analysis (design/ vs DESIGN_BRIEF.md):

1. **Dark theme is documentation-only** in mockups → authored for real in Phase 1; every component built in both themes from Phase 3 on.
2. **`--font-serif` token lacks Literata** (Newsreader has no Cyrillic) → fixed in Phase 1.
3. **No EN screen variants drawn** → EN goes in from Phase 1 (next-intl) and is audited in Phase 9.
4. **Email templates never mocked** → designed in code (Phase 7b) following the ledger aesthetic.
5. **Wish-card state matrix scattered across screens** → consolidated as the Phase 3 component playground.
6. **FAB drawn only in Directions (square, 2px border)** → implemented per turn-3 mocks.
7. `design/uploads/patterns.html` is reference material from the donor design system (finance cabinet) — component recipes only, its product content is irrelevant to Wishka.

## v2 backlog (not planned yet)

AI gift assistant (chat over profile+list) · Secret Santa · chip-in coordination (no payments ever) · events & date reminders · PWA share target · "surprise me" wish type · currency conversion display.
