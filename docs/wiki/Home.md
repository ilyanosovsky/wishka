# Wishka Wiki

**Wishka** — an open-source, mobile-first wishlist service. Paste a product link → the wish card assembles itself (image, title, price, description, with AI fallbacks). Share your list — friends and guests reserve gifts while the owner never sees reservations, so surprises survive and gifts never duplicate.

## Pages

- **Home** — this page
- [Local Setup](Local-Setup) — clone, run, quality gate
- [Architecture](Architecture) — layout, key decisions, diagram
- [Data Model](Data-Model) — schema, surprise invariant, visibility rules
- _Parsing pipeline_ — coming with the parsing PR

## How this wiki works

The wiki source of truth lives in the main repo at [`docs/wiki/`](https://github.com/ilyanosovsky/wishka/tree/main/docs/wiki). Every PR that changes behavior, architecture, or setup updates those files; on merge to `main` a GitHub Action syncs them here. **Do not edit the wiki directly** — changes will be overwritten by the next sync.

## Key documents in the repo

- [VISION.md](https://github.com/ilyanosovsky/wishka/blob/main/VISION.md) — product vision & decisions (RU)
- [DESIGN_BRIEF.md](https://github.com/ilyanosovsky/wishka/blob/main/DESIGN_BRIEF.md) — UX spec: screens, states, flows (RU)
- [IMPLEMENTATION_PLAN.md](https://github.com/ilyanosovsky/wishka/blob/main/IMPLEMENTATION_PLAN.md) — build plan with live statuses
