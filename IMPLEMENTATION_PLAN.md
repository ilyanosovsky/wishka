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
| 7 | Sharing & reservations: public lists, guests, surprise mode | 7a ✅ PR #7 · 7b next | 🔵 |
| 8 | Groups, partner, visibility, view-as | — | ⬜ |
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

## Phase 6 — AI assists & quotas (next PR)

**Goal:** AI fills gaps — on explicit tap, within budget.

- ⬜ "Добавь словами": free text → structured wish draft (type, category, price range, description).
- ⬜ Description & price suggestions in the form (accept/edit, error states never block saving).
- ⬜ Image generation (`OPENAI_MODEL_IMAGE`, low, 1024×1024): async job (DB status on wish) — save immediately, card shows "Рисуем…" → toast when ready / failure state with retry+upload.
- ⬜ Per-user daily quotas in `ai_usage` (server-enforced): counters in UI ("Осталось N"), exhausted states.
- ⬜ Tests: quota accounting, prompt-builder unit tests, job state machine.
- **Wiki:** `AI-Features.md` (+ costs note). **Model:** Opus (async job + quotas), Sonnet (form UI).

## Phase 7 — Sharing, guests, reservations (split: 7a public lists, 7b reservations)

**Goal:** the reason Wishka exists — sharing + surprise-safe reservations.

**7a:**
- ✅ Public profile+list `/u/[nickname]` (header, "Что важно знать", grid with badges, "Только свободные" filter, empty states); guest banner (RU/EN switch, "Создать свой"); single-wish share `/w/[id]`; share sheet (copy link, native share fallback, restricted-visibility warning); no tab bar/FAB for guests. Fixed a Phase-4 RSC bug (icons across the server/client boundary) via AppTabBar.
- ✅ Profile screen (§6.6): public-status line, sizes/tastes/no-gift editor (server-sanitized), settings (language, theme, currency, logout). Partner + view-as + delete-account deferred to Phase 8/later.

**7b:**
- ⬜ Reservation lifecycle: reserve (auth or guest), conflict handling (race → "уже забронировали"), unreserve with confirmation+undo; owner-side: zero traces (data-access layer from Phase 2 + e2e-style tests).
- ⬜ Guest identity: device token + optional email; success screen, other-device state, "manage booking" email link (Resend); guest→account merge on signup.
- ⬜ "Мои брони" tab: list with owner avatars, changed/deleted-by-owner states, recently-viewed lists, empty state. Emails: booking confirmation, owner-changed/deleted booked wish, gift-marked-given.
- ⬜ Service screens (§6.10): invalid link, no access, expired invite, expired session.
- **Wiki:** `Reservations-and-Surprise-Mode.md`, `Guest-Access.md`. **Model:** Opus (both halves — this is the crown jewel), Sonnet (emails, service screens).

## Phase 8 — Groups, partner, visibility (next PR)

**Goal:** the social fabric + real per-wish privacy.

- ⬜ Groups: list, first-run, create sheet (emoji/color, invite link), group detail (member grid, admin meatball menu), roles (creator=admin, transfer on leave), invite acceptance (+already-member, expired), leave/remove confirmations with visibility-consequence copy, V2 placeholder block.
- ⬜ Partner: assign/remove in profile (from group members).
- ⬜ "Кому видно" sheet live: everyone / groups / persons (partner pinned); wired into the data-access visibility rules; narrowing-after-reservation rule (reservation survives, reserver loses access, email sent).
- ⬜ "Посмотреть, как видят другие": view-as guest/group/person with preview banner; **reservations never shown in preview**.
- **Wiki:** `Groups-and-Visibility.md`. **Model:** Opus (visibility+RLS integration), Sonnet (group CRUD UI).

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
