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

Required services (all free tiers): a Postgres database (we use Railway), [Resend](https://resend.com) for auth-code emails, [UploadThing](https://uploadthing.com) for images, and a Google OAuth client. Every key is documented in [`.env.example`](https://github.com/ilyanosovsky/wishka/blob/main/.env.example).

### Database

```bash
npm run db:migrate    # applies drizzle/ migrations to DATABASE_URL
```

Tests do NOT need a database — they run the same migrations on in-process PGlite.

### Google OAuth

Google Cloud Console → Credentials → OAuth client (Web): authorized redirect URI = `<NEXT_PUBLIC_APP_URL>/api/auth/callback/google` (add both `http://localhost:3000/...` and the production URL).

### Agent tooling (optional)

The repository includes shared coding-agent instructions in `AGENTS.md`, a
Firecrawl skill entry point in `.agents/skills/firecrawl/SKILL.md`, and a
repo-local Codex MCP declaration in `.codex/config.toml`. The MCP declaration
uses Firecrawl's OAuth endpoint; no API key or session credential is committed.
Each contributor authorizes their own Firecrawl account locally when they use
the integration.

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
