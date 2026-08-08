# AI Features

> Phase 6. Three assists on top of the manual form, all opt-in (product invariant #4 — AI only runs on an explicit tap, never automatically). Code: `src/lib/ai/` (server), `src/app/wishes/ai-actions.ts` (server actions), `src/components/wishes/wish-form.tsx` + `add-wish-sheet.tsx` (UI).

## The three assists

| Assist | Entry point | What it does |
|---|---|---|
| **Draft from words** | "Добавь словами" in the add-wish sheet | Free text → a structured draft (title/type/category/description/price) via `draftWishFromTextAction`, handed off to the step-3 form the same way a URL parse is (sessionStorage key `wishka-ai-draft` → `/wishes/new?ai=1`) |
| **Suggest description / price** | Ghost buttons on the step-3 form | `suggestDescriptionAction` / `suggestPriceAction` propose a candidate; the owner explicitly **accepts** or **dismisses** it — nothing is ever applied silently |
| **Generate image** | "Сгенерировать (AI)" toggle in the photo section | Arms image generation for this save; the wish always saves first, generation runs after (see below) |

None of the three ever blocks saving a wish (invariant #3): a rejected, failed, or timed-out AI call degrades to the manual path — an empty description field, an unfilled price, no image — never an error that stops the save.

## Quotas

Per-user, per-UTC-day, enforced server-side (`src/lib/ai/quota.ts`) — the client-side counters (`ai.textQuotaLeft` / `ai.imageQuotaLeft`) are advisory only; the server always re-checks, so a stale or spoofed client count can never over-spend the budget.

| Pool | Daily limit | Counts against it |
|---|---|---|
| `text` | 30 | Draft-from-words, description suggestion, price suggestion — one shared pool |
| `image` | 10 | Image generation (armed-on-save or retried from a `failed` card) |

Quota is consumed **before** the underlying model call runs, not after — a client that never taps an AI affordance spends nothing, but once triggered the unit is spent whether or not the call succeeds; it is never refunded on a model failure or timeout. For image generation specifically, that same before-the-call consumption happens **before** the async job is scheduled, so a refused quota check leaves the wish's `imageStatus` untouched (it isn't flipped to `generating` for a job that will never run).

Saving a wish with "Сгенерировать (AI)" armed but the image quota already exhausted still saves the wish normally, with no image and no error — the armed flag is silently a no-op in that case (invariant #3 wins over the AI feature).

## Models — env-only, one-line swap

Every AI call reads its model name from an environment variable, never a hardcoded string (invariant #4 — OpenAI is retiring older models through 2026, so a swap must never touch code):

- `OPENAI_MODEL_TEXT` — draft-from-words, description suggestions, price suggestions.
- `OPENAI_MODEL_IMAGE` — image generation (`gpt-image-2`-class, 1024×1024, quality `low`).

No AI call ever sets `temperature`. Text calls use strict JSON-schema structured outputs; every raw model response is re-validated field-by-field before it becomes a `WishDraft` or suggestion (`src/lib/ai/draft.ts`) — category must be one of `CATEGORY_KEYS`, currency must be ISO-4217 or dropped, prices go through the same normalization as manual entry. User free text is confined to the user role in every prompt; system prompts are static and never interpolate user content, closing the obvious prompt-injection angle.

## Async image lifecycle

Image generation is the one assist that doesn't finish within the request — it runs in a Vercel `after()` job after the wish (create or edit) has already saved. The wish row's `imageStatus` **is** the job state; there is no separate job table.

```text
none ──(armed + saved, or retried from failed)──▶ generating ──▶ ready
                                                       │
                                                       └────────▶ failed
```

- **`none`** — no image, or the owner hasn't touched the AI image affordance.
- **`generating`** — the job is running. The card/detail view shows a shimmer placeholder (`wish.imageGenerating`). A client-side poller (`WishImagePoller`, `src/components/wishes/wish-image-poller.tsx`) checks `getWishImageStateAction` every ~3 seconds and gives up after ~3 minutes, leaving the card on whatever the row says — the job itself always lands a terminal status via try/catch, so the 3-minute cutoff is belt-and-braces, not the primary mechanism.
- **`ready`** — the generated image is re-hosted through `lib/storage/` like every other wish image (invariant #6 — never a raw OpenAI URL on a wish). The owner sees a toast (`ai.imageReady`) and the view refreshes.
- **`failed`** — always the terminal state on any failure, even if the wish already had an older image key. The card offers **Повторить** (`generateWishImageAction`, restart) and **Загрузить фото** (a normal manual upload, which — like a fresh photo pick anywhere on the form — wins over a stuck AI attempt). Retry is also allowed from a stale `generating` (the same `generateWishImageAction` restart semantics), for a job that got stuck without ever reaching a terminal status.

Uploading a photo manually while a generation is in flight is a race the upload wins: `finishImageGeneration` only updates rows still in `generating`, so a manually-uploaded photo can never be clobbered by a late-arriving generation result.

## Degraded mode — no `OPENAI_API_KEY`

Every page that could show an AI affordance checks `isAiAvailable()` server-side before rendering anything. Without a key:

- The "Добавь словами" entry doesn't appear in the add-wish sheet.
- The description/price suggestion buttons and the "Сгенерировать (AI)" toggle don't appear on the form.
- The server actions themselves still guard independently and resolve `{ ok: false, reason: "unavailable" }` rather than throwing — a stale client that somehow still renders an AI control degrades to the same calm not-blocking UI as a quota or network failure, never a crash.

This is the same "hidden, not just disabled" pattern used for every other optional integration in this codebase (Firecrawl/Jina in the parsing pipeline): a self-hosted instance without the key behaves as if the feature doesn't exist, with zero broken UI.

## Costs

Image generation is the expensive operation of the three by a wide margin — the daily `image` quota (10/user/day) is the primary lever bounding worst-case spend per user. Text assists (draft/description/price) are comparatively cheap structured-output calls on a smaller model; their shared 30/day pool exists mainly to prevent runaway/automated use, not because any single call is costly. Both pools reset at UTC midnight (`usageDay()`, shared with the parsing pipeline's own daily quota).
