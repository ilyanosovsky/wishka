# Wishka 🎁

**An open-source, mobile-first wishlist service.** Paste a product link — the wish card assembles itself (image, title, price, description, with AI fallbacks). Share your list with family and friends; they reserve gifts while you never see the reservations. Surprises survive, gifts never duplicate.

> Built as a personal pet project, designed to be usable by anyone. Runs entirely on free tiers.

## Why another wishlist?

Our old “wishlist” was a shared iPhone note. It worked until it didn’t: duplicated gifts, spoiled surprises, no images, mixed currencies, and no way to hint sizes or tastes. Wishka fixes exactly that:

- **Paste a link → get a card.** Layered parsing (Open Graph / JSON-LD → LLM extraction → rendering proxies) with graceful manual fallback — adding a wish never fails, it just asks for help.
- **Surprise mode, always on.** Friends and guests see “reserved”; the list owner never does — enforced at the database level, not just hidden in the UI.
- **Guests without accounts.** Grandma opens a link, reserves a gift, done.
- **AI where it helps.** Generate a product image, suggest a description or price estimate, turn “swim with whales” into a structured wish — every AI action is an explicit button with daily quotas.
- **Profiles that help gift-givers.** Public sizes, tastes, and a “please don’t gift” list.
- **Groups.** Family and friends in one place; each wish can be visible to everyone, selected groups, or selected people only.
- **Multi-currency.** Every wish keeps its own currency ($, €, ₾, ₽, …).
- **RU + EN, light + dark** from day one.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript strict |
| Database / Auth / Storage | Supabase (Postgres + RLS, Google OAuth + email OTP, Storage) |
| Styling | Tailwind CSS, design tokens from the “Paper Ledger” design system |
| i18n | next-intl (RU / EN) |
| AI | OpenAI (`gpt-5.6-luna` for extraction, `gpt-5-mini` for the gift assistant, `gpt-image-2` for images) — all model names via env |
| Email | Resend (Supabase SMTP + transactional) |
| Testing | Vitest + Testing Library |
| Hosting | Vercel |

Design: a warm, paper-ledger aesthetic — serif headings (Newsreader), hairline rules, square corners, one muted ledger-green accent. Mockups and tokens live in [`design/`](design/).

## Getting started

```bash
git clone https://github.com/ilyanosovsky/wishka.git
cd wishka
npm install
cp .env.example .env.local   # fill in Supabase + OpenAI keys
npm run dev
```

You’ll need a (free) [Supabase](https://supabase.com) project and an [OpenAI](https://platform.openai.com) API key. See [`.env.example`](.env.example) for every variable and [`CLAUDE.md`](CLAUDE.md) for the full setup notes (Google OAuth, Resend SMTP).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest |

## Project documents

- [VISION.md](VISION.md) — product vision & decisions (RU)
- [DESIGN_BRIEF.md](DESIGN_BRIEF.md) — full UX spec: screens, states, flows (RU)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — build plan with live statuses
- [Wiki](https://github.com/ilyanosovsky/wishka/wiki) — architecture & guides (synced from [`docs/wiki/`](docs/wiki/))

## Contributing

The project is developed through PRs only (`main` is protected): lint + typecheck + tests must pass, the implementation plan status must be updated, and behavior changes update the wiki source in `docs/wiki/`. See [`CLAUDE.md`](CLAUDE.md) for the working agreements.

## License

[MIT](LICENSE) © 2026 Ilya Nosovsky and Wishka contributors
