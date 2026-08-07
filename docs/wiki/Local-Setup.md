# Local Setup

## Prerequisites

- Node.js 22+
- npm (lockfile is npm-managed)

## Run

```bash
git clone https://github.com/ilyanosovsky/wishka.git
cd wishka
npm install
cp .env.example .env.local   # see the table in CLAUDE.md for every key
npm run dev                  # http://localhost:3000
```

The scaffold phase needs **no external services** — the app boots without any env vars. Database (Railway Postgres), auth (Better Auth: Google OAuth + email codes via Resend) and image storage (UploadThing) arrive in Phase 2+; their keys are documented in [`.env.example`](https://github.com/ilyanosovsky/wishka/blob/main/.env.example).

## Quality gate (same as CI)

```bash
npm run lint
npm run typecheck
npm test
```

CI (`.github/workflows/ci.yml`, job `ci`) runs exactly these three on every PR. Tests must never require network or real services.

## Conventions

- TypeScript strict; no `any` without a justifying comment.
- Prettier formats code (`npm run format`); Markdown and `design/` are excluded.
- Vitest tests are colocated: `*.test.ts(x)` next to the code.
- Every PR updates `IMPLEMENTATION_PLAN.md` statuses and, when behavior/architecture/setup changes, the `docs/wiki/` pages (auto-synced to this wiki on merge).
