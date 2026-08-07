# Data Model

> Schema source of truth: `src/db/schema.ts` (Drizzle); SQL migrations in `drizzle/`. Runs on Railway Postgres; tests run the same migrations on in-process PGlite (no docker, no network).

## Tables

**Auth (Better Auth defaults):** `user`, `session`, `account`, `verification`.

**Product:**

| Table | Purpose |
|---|---|
| `profiles` | 1:1 with `user`: unique `nickname` (public URL `/u/<nickname>`), `base_currency`, `partner_id`, `sizes`/`tastes`/`no_gift` (jsonb) |
| `wishes` | The wish card: type (product/experience/service/certificate), title, url, image key+status, price (`none`/`exact`/`range` + per-wish currency), priority, `is_dream`, category, notes, visibility (`everyone`/`restricted`), status (`active`/`gifted`), `gifted_by` (**free text — never an FK**) |
| `wish_visibility` | Rows for `restricted` wishes: subject = group or user |
| `groups`, `group_members` (role admin/member), `group_invites` | Social fabric |
| `guest_identities` | Guests: device `token` + optional email |
| `reservations` | Reservation lifecycle; reserver is **exactly one of** user / guest (CHECK); at most one `active` per wish (partial unique index) |
| `parsed_url_cache` | One parse per URL across all users |
| `ai_usage` | Per-user daily AI quotas (`user_id`, `day`, `kind`) |

## The surprise invariant (product invariant #1)

The list owner must never see reservations of their own wishes. Enforced in layers:

1. `wishes` carries **no reservation-derived column** (test inspects `information_schema`).
2. The database is **server-only**; all reads go through `src/db/access/`:
   - `owner.ts` — owner-facing queries touch only the `wishes` table; a test asserts the module source never references reservations; DTO `OwnerWish` has no reservation field.
   - `viewer.ts` — non-owner reads get `reservationStatus: free | reserved | reserved_by_you`.
3. Snapshot test: `getOwnerWishes` output is byte-identical with and without an active reservation.

## Visibility rules (`viewer.ts`)

- `everyone` → visible to anyone, including anonymous guests.
- `restricted` → only authenticated users matching a `wish_visibility` row: named directly (`subject_type='user'`) or sharing a listed group **with the owner**. Restricted wishes are never shown to guests.
- Gifted wishes are archive: owner-only.

## Reservations

`reserveWish` returns `{ok:false, reason:'already_reserved'}` on the partial-unique-index conflict — race-safe at the DB level. `cancelReservation` only cancels the caller's own active reservation. Cancelled reservations free the slot.

## Conventions

- camelCase in TS ↔ snake_case in DB, spelled out per column (no global casing magic).
- Nickname rule `/^[a-z0-9-]{3,30}$/` lives in `src/lib/nickname.ts` (client-safe); DB adds a unique index on `lower(nickname)`.
- `getDb()` reads `DATABASE_URL` lazily (import-safe without env); postgres.js `prepare:false`, `max:1`, `idle_timeout:20` — per-lambda pools multiply under serverless fan-out, so each instance keeps a single short-lived connection.
- Auth rate limiting persists in the `rate_limit` table (Better Auth `storage:"database"`) — in-memory counters reset per lambda and are useless on Vercel.
