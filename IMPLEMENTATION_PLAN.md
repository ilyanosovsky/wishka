# Wishka — Implementation Plan

> **Living document.** Every PR updates the status of the step(s) it advances. Statuses: ⬜ todo · 🔵 in progress · ✅ done · ⏸ blocked.
> Ground rules live in [CLAUDE.md](CLAUDE.md). UX source of truth: [DESIGN_BRIEF.md](DESIGN_BRIEF.md) + `design/` mockups (Paper Ledger, final synthesis "3a–3c").
> Model policy: Fable orchestrates; complex steps → Opus subagents; small/mechanical steps → Sonnet subagents.

## Status overview

| Phase | Scope | PR | Status |
|---|---|---|---|
| 0 | Bootstrap: docs, license, repo, protection | — (direct, pre-protection) | ✅ done |
| 1 | Scaffold: Next.js, tokens, themes, i18n, CI | PR #1 | ⬜ |
| 2 | Database (Railway PG + Drizzle), Better Auth, onboarding | PR #2 | ⬜ |
| 3 | Design system: components + wish card matrix | PR #3 | ⬜ |
| 4 | My list: CRUD, filters, detail, archive | PR #4 | ⬜ |
| 5 | Add by URL: parsing pipeline + image re-hosting | PR #5 | ⬜ |
| 6 | AI assists: text-to-wish, suggestions, image gen, quotas | PR #6 | ⬜ |
| 7 | Sharing & reservations: public lists, guests, surprise mode | PR #7 (7a/7b) | ⬜ |
| 8 | Groups, partner, visibility, view-as | PR #8 | ⬜ |
| 9 | Polish & launch: i18n/dark audit, a11y, prod config | PR #9 | ⬜ |

Design-debt items carried from mockup analysis are folded into phases 1 and 3 (see "Design deviations to resolve" below).

---

## Phase 0 — Bootstrap ✅

Repo initialized with docs (VISION, DESIGN_BRIEF, this plan), CLAUDE.md, README, MIT license, .env.example, PR template, wiki sync workflow (`docs/wiki/` → GitHub Wiki on merge), `design/` mockups. `main` protected: PRs only, linear history, no force pushes. *Everything after this phase goes through PRs.*

## Phase 1 — Scaffold & tooling (PR #1)

**Goal:** empty but deployable app with the full quality gate.

- ⬜ `create-next-app` (TypeScript, App Router, no src dir decision documented in wiki), strict tsconfig.
- ⬜ Tailwind wired to **CSS variables from `design/uploads/tokens.css`** (keep var names). Fix `--font-serif` to `'Newsreader','Literata',Georgia,serif` (Cyrillic!).
- ⬜ Dark theme: author `:root[data-theme="dark"]` override from the "night ledger" palette (`bg #1f1c16 · paper #292519 · ink #e8e2d2 · accent #8fb39e · accent-soft #2e3a32 · rule #3a352a · rule-2 #4a4436 · null-txt #d8b25e · neg #c97a6e`); derive missing dark tokens (zebra, soft families, shadows) and mint tokens for ad-hoc colors (undo-toast green `#9cc3ad`, 40% ink scrim). 3-way toggle Light/Dark/System (persisted, no-flash script).
- ⬜ Fonts via `next/font` (Newsreader, Literata, Inter, JetBrains Mono).
- ⬜ next-intl: RU + EN message catalogs, browser-language default, locale switcher primitive.
- ⬜ ESLint (`next/core-web-vitals`) + Prettier + `npm run typecheck`.
- ⬜ Vitest + @testing-library/react + happy-dom; example test.
- ⬜ CI workflow `.github/workflows/ci.yml`: lint → typecheck → test (job name `ci`); after merge, add `ci` to required status checks on `main`.
- ⬜ Vercel project connected (preview deploys on PRs).
- **Wiki:** `Local-Setup.md`, `Architecture.md`. **Model:** Sonnet (scaffolding), Opus (theme/token system).

## Phase 2 — Database, auth, onboarding (PR #2)

> Stack revised 07.08.2026 (Supabase → Railway/Better Auth, see VISION.md §5.1): Supabase free tier caps at 2 active projects per account; Railway Hobby is already paid with unused credits.

**Goal:** login works end-to-end; schema + data-access layer enforce the product's privacy core.

- ⬜ Railway: new `wishka` project with Postgres service (enable backups); `DATABASE_URL` into `.env.local`/Vercel.
- ⬜ Drizzle ORM + drizzle-kit migrations in `drizzle/`; typed schema.
- ⬜ Schema v1: `profiles` (nickname unique, base_currency, partner_id, sizes jsonb, tastes jsonb, no_gift jsonb), `wishes` (type, title, url, image_key, description, price exact/range + currency, priority, is_dream, category, notes, visibility mode, status, archived fields), `wish_visibility` (wish ↔ group/person), `groups`, `group_members` (role), `group_invites`, `reservations` (wish, reserver profile **or** guest identity, state), `guest_identities` (token, email), `parsed_url_cache`, `ai_usage` + Better Auth tables (user/session/account/verification via Drizzle adapter).
- ⬜ **Data-access layer (`lib/db/`) — the surprise invariant:** DB is server-only; owner-facing query builders **cannot select reservation data by construction** (viewer-role-scoped modules + DTOs). Visibility rules (everyone / groups / persons / partner) live in the same layer. Vitest proves both against a local Postgres (docker; CI job included).
- ⬜ Better Auth: Google OAuth + email OTP plugin (6-digit codes sent via Resend), sessions in Postgres, middleware, protected routes.
- ⬜ Login + code screens with all mocked states (§6.1); mini-onboarding (name, avatar upload+crop+compress client-side, nickname with live availability, base currency); skippable.
- ⬜ `lib/storage/` adapter interface + UploadThing implementation (used for avatars here, product images in Phase 5).
- **Wiki:** `Data-Model.md`, update `Local-Setup.md` (Railway, Google OAuth, Resend, UploadThing). **Model:** Opus (schema/data-access/auth), Sonnet (screens).

## Phase 3 — Design system components (PR #3)

**Goal:** the Paper Ledger kit, so feature phases assemble instead of invent.

- ⬜ Base: Button (primary/danger/loading ≥44px), Field (focus/error/locked/parsed-link), segmented Tabs (ink-active and accent-active variants), Chips, BottomSheet (square, drag-handle, up-shadow), Dialog (+destructive-right rule), Toast (undo with 5s progress bar), Avatar (round) + square masthead avatar, TabBar (3 tabs, 2px top rule), square FAB, alert banners, OTP input, skeleton/shimmer.
- ⬜ Badges: status (Свободно / Забронировано / Забронировано вами / Подарено), rotated "Мечта" stamp, nullpill "нет цены", priority flag triangle, visibility lock badge.
- ⬜ **WishCard with the full state matrix** (role × status × modifiers: dream, priority, restricted visibility, no-image category placeholder, generating shimmer, generation failed, 2-line clamp, price range, no price, any currency). Owner variant renders **identically** with or without reservations — test asserts the component API doesn't even accept reservation data in owner mode.
- ⬜ Icons: lucide-react, strokeWidth ≈2.4, fill none.
- ⬜ `/dev/ui` playground route (dev-only) showing every component in both themes.
- **Wiki:** `Design-System.md`. **Model:** Opus (WishCard, BottomSheet), Sonnet (rest).

## Phase 4 — My list & wish CRUD (PR #4)

**Goal:** the owner's core loop without parsing/AI.

- ⬜ My list screen: header (share icon, archive entry, search), filter chips + sort, **card view (3a) / ledger list view (3b) switcher** (design addition — keep it), 2-col grid, all states (skeleton+offline, empty, filtered-empty, error, pull-to-refresh, infinite scroll).
- ⬜ Manual add/edit form (§6.3 step 3, sans AI): type tabs, price exact/range + currency sheet, priority + dream toggle, category, notes, visibility summary row (stub until Phase 8: "everyone" only), draft persistence + "Сохранить черновик?".
- ⬜ Own wish detail; "Уже подарили" sheet ("кто подарил" free-text / group suggestions — **never from reservations**); delete with undo toast; archive screen (year groups, restore, permanent delete).
- **Wiki:** update `Architecture.md`. **Model:** Opus (list orchestration/drafts), Sonnet (archive, forms).

## Phase 5 — Add by URL: parsing pipeline (PR #5)

**Goal:** paste a link → card assembles; failure is a calm, first-class path.

- ⬜ `/api/parse`: **L0** fetch + open-graph-scraper (OG+JSON-LD, real UA, 8s timeout, challenge-page detection) → **L1** LLM extraction over cleaned HTML (`OPENAI_MODEL_TEXT`, structured outputs) → **L2** Jina Reader (`r.jina.ai`) → **L3** Firecrawl (free 1000/mo) → give up gracefully. Stop-list (Amazon-class) → manual immediately. Cache results in `parsed_url_cache` (one parse per URL globally).
- ⬜ **Image re-hosting:** server-side fetch, content-type/size validation, store copy via `lib/storage/` adapter (UploadThing UTApi; swappable to Railway Buckets); `next/image` remotePatterns = our storage host only.
- ⬜ Add-by-URL UI: clipboard suggestion, parsing states (fast <3s / slow >5s with escape hatch / partial with highlights / failed calm / stop-list / duplicate detection).
- ⬜ Tests: pipeline layering + fail detection on fixture HTML (Shopify-like OK, challenge pages, empty shells); no live network in CI.
- **Wiki:** `Parsing-Pipeline.md`. **Model:** Opus (pipeline), Sonnet (UI states).

## Phase 6 — AI assists & quotas (PR #6)

**Goal:** AI fills gaps — on explicit tap, within budget.

- ⬜ "Добавь словами": free text → structured wish draft (type, category, price range, description).
- ⬜ Description & price suggestions in the form (accept/edit, error states never block saving).
- ⬜ Image generation (`OPENAI_MODEL_IMAGE`, low, 1024×1024): async job (DB status on wish) — save immediately, card shows "Рисуем…" → toast when ready / failure state with retry+upload.
- ⬜ Per-user daily quotas in `ai_usage` (server-enforced): counters in UI ("Осталось N"), exhausted states.
- ⬜ Tests: quota accounting, prompt-builder unit tests, job state machine.
- **Wiki:** `AI-Features.md` (+ costs note). **Model:** Opus (async job + quotas), Sonnet (form UI).

## Phase 7 — Sharing, guests, reservations (PR #7 — split: 7a public lists, 7b reservations)

**Goal:** the reason Wishka exists — sharing + surprise-safe reservations.

**7a:**
- ⬜ Public profile+list `/u/[nickname]` (one screen: profile header, "Что важно знать", grid with badges, "Только свободные" filter, empty states); guest banner (RU/EN switch, "Создать свой"); single-wish share page; share sheet (copy link, native share fallback, QR optional, restricted-visibility warning); no tab bar/FAB for guests.
- ⬜ Profile screen (§6.6): public-status line, sizes/tastes/no-gift sheets, settings (language, theme, currency, logout, delete account).

**7b:**
- ⬜ Reservation lifecycle: reserve (auth or guest), conflict handling (race → "уже забронировали"), unreserve with confirmation+undo; owner-side: zero traces (data-access layer from Phase 2 + e2e-style tests).
- ⬜ Guest identity: device token + optional email; success screen, other-device state, "manage booking" email link (Resend); guest→account merge on signup.
- ⬜ "Мои брони" tab: list with owner avatars, changed/deleted-by-owner states, recently-viewed lists, empty state. Emails: booking confirmation, owner-changed/deleted booked wish, gift-marked-given.
- ⬜ Service screens (§6.10): invalid link, no access, expired invite, expired session.
- **Wiki:** `Reservations-and-Surprise-Mode.md`, `Guest-Access.md`. **Model:** Opus (both halves — this is the crown jewel), Sonnet (emails, service screens).

## Phase 8 — Groups, partner, visibility (PR #8)

**Goal:** the social fabric + real per-wish privacy.

- ⬜ Groups: list, first-run, create sheet (emoji/color, invite link), group detail (member grid, admin meatball menu), roles (creator=admin, transfer on leave), invite acceptance (+already-member, expired), leave/remove confirmations with visibility-consequence copy, V2 placeholder block.
- ⬜ Partner: assign/remove in profile (from group members).
- ⬜ "Кому видно" sheet live: everyone / groups / persons (partner pinned); wired into the data-access visibility rules; narrowing-after-reservation rule (reservation survives, reserver loses access, email sent).
- ⬜ "Посмотреть, как видят другие": view-as guest/group/person with preview banner; **reservations never shown in preview**.
- **Wiki:** `Groups-and-Visibility.md`. **Model:** Opus (visibility+RLS integration), Sonnet (group CRUD UI).

## Phase 9 — Polish & launch (PR #9)

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
