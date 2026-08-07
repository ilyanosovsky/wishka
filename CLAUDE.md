# CLAUDE.md — Wishka project rules

## What this is

Wishka — open-source, mobile-first wishlist web service: paste a product URL → the card assembles itself; friends reserve gifts without the list owner ever seeing it (surprise mode). Personal pet project of Ilya, built to be usable by anyone.

Key documents (read before non-trivial work):
- [VISION.md](VISION.md) — product vision and decisions (RU)
- [DESIGN_BRIEF.md](DESIGN_BRIEF.md) — full UX spec: screens, states, flows (RU)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — build plan with **live statuses** (keep it updated!)
- `design/` — Claude Design mockups. Direction: **Paper Ledger**. Design tokens: `design/uploads/tokens.css` (source of truth for colors/type/spacing)

## Language

- Chat with Ilya: **Russian**.
- Everything in the repo — code, comments, commits, PR titles/bodies, wiki, README: **English**.

## Models & orchestration

- **Fable** — orchestration and planning (main loop).
- **Opus** — complex implementation tasks (pass `model: 'opus'` to subagents/workflow stages).
- **Sonnet** — small/mechanical tasks (`model: 'sonnet'`).

## Git workflow — non-negotiable

- `main` is protected: **no direct pushes, PRs only**, squash merge, linear history.
- Branch names: `feat/…`, `fix/…`, `docs/…`, `chore/…`. Commits: Conventional Commits.
- Every PR must:
  1. Pass CI: lint, typecheck, vitest.
  2. **Update IMPLEMENTATION_PLAN.md** — set the status of the step(s) it advances.
  3. **Update `docs/wiki/`** when it changes user-facing behavior, architecture, data model, or setup. The wiki auto-syncs to GitHub Wiki on merge to `main` (`.github/workflows/wiki-sync.yml`).
  4. Contain no secrets. Env values live in `.env.local` (gitignored) and Vercel project settings; `.env.example` documents the keys.

## Testing & quality

- **Vitest** + @testing-library/react. Tests colocated: `*.test.ts(x)`.
- Must be covered by tests: `lib/` business logic (parsing pipeline, AI quotas, visibility rules, reservation rules), API route handlers, non-trivial components.
- TypeScript `strict`. ESLint (`next/core-web-vitals`) + Prettier. No `any` without a comment justifying it.

## Product invariants — never violate

1. **The owner must never see reservations of their own wishes.** Enforced at the RLS/database level, not just hidden in UI. Covered by tests. No owner-facing screen may render anything derived from reservations.
2. Item-level visibility (everyone / selected groups / selected people) is enforced by RLS.
3. Adding a wish never blocks on parsing or AI success — manual entry is a first-class path.
4. AI actions run only on explicit user action, with per-user daily quotas. Model names come **only from env vars** (OpenAI retires models Dec 2026 — swap must be a one-line change).
5. No payments and no monetization UI whatsoever (Vercel Hobby ToS prohibits even donation buttons).
6. External product images are re-hosted into Supabase Storage on wish creation. No hotlinking, no `remotePatterns` wildcards.
7. RU + EN and light + dark theme from day one: every UI string goes through i18n messages (no hardcoded strings); UI changes must be checked in both themes.

## Stack (fixed decisions)

Next.js App Router on Vercel Hobby · Supabase free tier (Postgres + Auth + Storage; SQL migrations in `supabase/migrations/` via Supabase CLI) · next-intl (RU/EN) · Tailwind CSS with tokens mapped from `design/uploads/tokens.css` · Vitest · OpenAI (text extraction/descriptions: `gpt-5.6-luna`; gift assistant: `gpt-5-mini`; images: `gpt-image-2` — all via env) · Resend (custom SMTP for Supabase auth emails + app transactional emails) · URL parsing pipeline: OG/JSON-LD fetch → LLM extraction → Jina Reader → Firecrawl → manual entry; results cached by URL; Amazon-class stop-list goes straight to manual.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local`, Vercel | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local`, Vercel | Supabase anon key (RLS-guarded) |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local`, Vercel (sensitive) | Server-only: storage re-hosting, quota accounting |
| `OPENAI_API_KEY` | `.env.local`, Vercel (sensitive) | All AI features |
| `OPENAI_MODEL_TEXT` | `.env.local`, Vercel | Default `gpt-5.6-luna` |
| `OPENAI_MODEL_ASSISTANT` | `.env.local`, Vercel | Default `gpt-5-mini` |
| `OPENAI_MODEL_IMAGE` | `.env.local`, Vercel | Default `gpt-image-2` |
| `RESEND_API_KEY` | `.env.local`, Vercel (sensitive) | Transactional emails |
| `EMAIL_FROM` | `.env.local`, Vercel | Sender address |
| `FIRECRAWL_API_KEY` | `.env.local`, Vercel (optional) | Parsing layer 3 |
| `JINA_API_KEY` | `.env.local`, Vercel (optional) | Parsing layer 2 (higher rate limits) |
| `NEXT_PUBLIC_APP_URL` | `.env.local`, Vercel | Absolute URLs in emails/share links |
| `CRON_SECRET` | Vercel | Protects cron endpoints (keep-alive) |

Configured in dashboards, not env: Google OAuth client (Google Cloud Console → Supabase Auth), Resend SMTP relay (Supabase Auth → SMTP settings), Supabase redirect URLs. CI needs no secrets — tests must run without external services.
