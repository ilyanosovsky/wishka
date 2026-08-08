# Parsing Pipeline

> Paste a product URL → the wish card assembles itself. Code: `src/lib/parse/`; entry: `parseUrlAction` (`src/app/wishes/parse-actions.ts`). **Adding a wish never blocks on parsing success** (product invariant #3) — every failure path lands in the manual form with the URL preserved.

## Layers (cheapest first; each runs only if the previous failed)

| Layer | What | Cost | Covers |
|---|---|---|---|
| L0 | Server fetch + Open Graph / JSON-LD (open-graph-scraper) | $0, ~1–2s | Shopify-class and regular stores (live-tested Aug 2026) |
| L1 | LLM extraction over the fetched, cleaned HTML (`OPENAI_MODEL_TEXT`, structured outputs) | fractions of a cent | Pages with messy/absent metadata |
| L2 | Jina Reader (`r.jina.ai`) renders JS shells → markdown → L1 | free (~20 rpm keyless; `JINA_API_KEY` raises limits) | SPA shells without active bot walls |
| L3 | Firecrawl scrape → markdown → L1 (`FIRECRAWL_API_KEY`, 1000 pages/mo free) | free tier | Harder marketplaces |
| L4 | Manual form, URL prefilled | — | Everything else, always available |

**Stop-list:** `amazon.*` goes straight to manual — Amazon serves no metadata to server fetches and its ToS forbids scraping.

**Challenge detection (L0):** blocked when status is 403/429/498/499, the body is implausibly small, or matches challenge markers (`captcha`, `bm-verify`, `antibot`, `punish`, `__wbaas`, …) — a 200 does not mean success.

## Caching and quotas

- Results cached in `parsed_url_cache` by SHA-256 of the **normalized** URL (tracking params `utm_*`/`fbclid`/… stripped, fragment dropped) — one parse per URL across all users, 7-day TTL. Cache hits are free and don't touch quotas.
- Per-user cap: 50 pipeline runs/day (`ai_usage`, kind `parse`). Over the cap → manual form.

## Images — invariant #6

External product images are **re-hosted during the parse**: validated (http(s), `image/*`, ≤8MB) and copied into our storage via `lib/storage/`; the form and the cache only ever see our CDN URL. Wish creation independently re-validates the host, so hotlinks cannot be stored even by hand-crafted requests. Failed re-hosting degrades to "no image" — never blocks.

## Duplicates

Before parsing, the user's active wishes are checked for the same URL — the sheet offers "Открыть её / Всё равно добавить" (§6.3).

## Security (SSRF)

The pipeline fetches URLs the user pastes, server-side — a classic SSRF surface, and this app is meant to be self-hosted by anyone. `src/lib/parse/ssrf.ts` guards every server-side fetch (L0, the image re-host, and the URL forwarded to Jina/Firecrawl):

- Rejects non-http(s), non-FQDN/single-label hosts, and cloud-metadata hostnames (`metadata.google.internal`).
- Rejects IP literals in loopback / private / link-local / CGNAT / unspecified / ULA / multicast ranges — including decimal, hex, octal and IPv4-mapped-IPv6 forms (folded to canonical shape, then range-checked).
- Resolves DNS and re-checks **every** resolved address against the same deny-ranges (blocks DNS→private).
- `redirect: "manual"` with per-hop re-validation (≤2 hops) so a public URL can't 302 to an internal one.

Residual, documented: the socket isn't pinned to the validated IP, so a DNS-rebinding TOCTOU window exists — accepted because fetched bytes are never echoed to the requester. Re-hosting additionally streams the body through the guard (never handing the raw URL to UploadThing), enforces the size cap while reading, and sniffs magic bytes — the shop's `Content-Type` is never trusted. A single overall 22s budget bounds the whole run so a slow store degrades to manual, not a platform timeout.
