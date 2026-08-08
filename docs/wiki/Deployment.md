# Deployment

Full checklist for taking Wishka from local dev to a production deploy. Every dashboard step below has no code counterpart — it lives only here.

## 1. Vercel

1. Import the GitHub repo as a new Vercel project (framework preset: Next.js, detected automatically).
2. Project → Settings → Environment Variables — add every key from [`.env.example`](https://github.com/ilyanosovsky/wishka/blob/main/.env.example) for the **Production** environment:
   - `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `OPENAI_MODEL_TEXT`, `OPENAI_MODEL_IMAGE`, `RESEND_API_KEY`, `EMAIL_FROM`, `UPLOADTHING_TOKEN`, `NEXT_PUBLIC_APP_URL` — required.
   - `OPENAI_MODEL_ASSISTANT` — set it, but it is read by nothing yet (reserved for the v2 gift assistant).
   - `FIRECRAWL_API_KEY`, `JINA_API_KEY` — optional parsing fallbacks; the pipeline degrades gracefully without them.
   - Mark `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `UPLOADTHING_TOKEN`, and `DATABASE_URL` **Sensitive** (Vercel hides their values from the dashboard after save).
   - `NEXT_PUBLIC_APP_URL` must be the production `https://` URL — `src/lib/auth.ts` refuses to boot in production without it, since it also drives the session cookie's `Secure` flag.
3. Deploy. Vercel Hobby is a fixed decision (see `CLAUDE.md`) — no payments/monetization UI is ever added, per product invariant #5.

## 2. Railway (Postgres)

1. Provision a Postgres service in the Railway project already paying for Hobby ($5/mo).
2. Copy `DATABASE_PUBLIC_URL` into Vercel's `DATABASE_URL`.
3. Apply migrations once against the production database: `npm run db:migrate` with `DATABASE_URL` pointed at Railway (run locally or via a one-off Vercel/CI job — `drizzle-kit` migrations live in `drizzle/`).
4. Set up backups — see [§6](#6-backups) below; Railway's Hobby tier has none built in.

## 3. Google OAuth (production redirect)

Google Cloud Console → APIs & Services → Credentials → the existing OAuth client (Web application):

- Add an **Authorized redirect URI**: `<NEXT_PUBLIC_APP_URL>/api/auth/callback/google` (the production URL — keep the `localhost:3000` one for dev too).
- No other Google-side config; Better Auth's `socialProviders.google` (`src/lib/auth.ts`) handles the rest server-side.

## 4. Resend (email)

1. Add and verify the sending domain in the Resend dashboard (DNS records: SPF/DKIM).
2. Set `EMAIL_FROM` to an address on that domain (e.g. `Wishka <hello@wishka.app>`). Until the domain is verified, `src/lib/auth.ts` and `src/lib/email/client.ts` fall back to Resend's own `onboarding@resend.dev` sender, which is fine for testing but not for real users (deliverability + branding).
3. `RESEND_API_KEY` is the same key for both auth-code emails and transactional emails (booking confirmations, wish-changed notices, etc. — see [Reservations and Surprise Mode](Reservations-and-Surprise-Mode)).

## 5. UploadThing (image storage)

1. Create a **production** UploadThing app (separate from the dev app used locally — different `UPLOADTHING_TOKEN`, different storage host).
2. Copy its token into Vercel's `UPLOADTHING_TOKEN`.
3. Nothing else to configure: `src/lib/storage/uploadthing.ts` derives the app's read host (`<appId>.ufs.sh`) from the token itself at boot, and every re-hosted image URL is checked against that exact host (product invariant #6 — no hotlinking, no wildcard `remotePatterns`).

## 6. Backups

`.github/workflows/db-backup.yml` runs a daily `pg_dump`, but ships **inert** — it does nothing until turned on, because this repo is public and a backup workflow is a new secret entering the Actions surface (a deliberate departure from "CI needs no secrets", scoped to this one scheduled job only).

**Turn it on:**

1. Generate an `age` keypair (once, offline — `age` is the tool the workflow uses to encrypt, so the private half must never enter the repo or Actions):
   ```bash
   age-keygen -o wishka-backup-key.txt
   # prints: Public key: age1...
   ```
   Store `wishka-backup-key.txt` somewhere durable and *outside* GitHub (a password manager, an encrypted drive) — it is the only way to ever decrypt a backup.
2. Set the database URL as a repo secret:
   ```bash
   gh secret set DATABASE_URL --body "postgresql://..."
   ```
3. Set the `age` public key and the enable flag as repo variables (variables are visible in the dashboard — safe, since it's only the public half):
   ```bash
   gh variable set AGE_PUBLIC_KEY --body "age1..."
   gh variable set BACKUP_ENABLED --body "true"
   ```
4. The workflow now runs daily at 03:17 UTC (or on demand via `gh workflow run db-backup.yml`), dumps the database with `pg_dump --format=custom` (already zlib-compressed — there is no separate gzip stage), encrypts it with `age -r "$AGE_PUBLIC_KEY"`, and uploads the **ciphertext only** as a 90-day artifact. `DATABASE_URL` is never echoed, printed, or written to a file.

**Why the job is fussy about failing:** a backup that fails silently is worse than no backup, so the dump step runs under `shell: bash` + `set -euo pipefail` (the *default* GitHub shell is `bash -e` **without** `pipefail`, which would let a failed `pg_dump` feed `age` an empty stream and still exit 0), and the step then refuses to upload a `dump.age` smaller than 10 kB.

**Keep the client pinned:** the install step pulls `postgresql-client-<PG_MAJOR>` from the PGDG apt repo, because `ubuntu-latest`'s stock package trails the server and a client older than the server makes `pg_dump` abort. When Railway's Postgres major moves, bump `PG_MAJOR` in `.github/workflows/db-backup.yml`.

**Restore:** (`pg_restore` reads the custom-format archive straight off the decrypted stream — no `gunzip` step)

```bash
gh run download <run-id> -n db-backup-<run-id>   # downloads dump.age
age -d -i wishka-backup-key.txt dump.age | pg_restore \
  --dbname "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges
```

## 7. Post-deploy smoke test

Run through these against the production URL before calling a deploy done:

- [ ] **Login** — email OTP round-trip (code arrives, signs in) and Google OAuth.
- [ ] **Add a wish by URL** — paste a real product link, confirm the card assembles (image, title, price).
- [ ] **AI assists are visible** — add-by-words entry point and the description/price suggestion cards appear on the wish form (quota permitting).
- [ ] **Share link** — copy a list link from the share sheet, open it in a private/incognito window, confirm the public list renders.
- [ ] **Reserve as a guest** — from that incognito window, reserve a wish without signing in; confirm the owner's own view of that wish shows no trace of the reservation (product invariant #1).
- [ ] **Emails arrive** — the guest booking confirmation and a wish-changed notice (edit the reserved wish's title as the owner) both land in the recipient's inbox.

## See also

- [Local Setup](Local-Setup) — the same checklist for a dev machine, not a production deploy.
- [`CLAUDE.md`](https://github.com/ilyanosovsky/wishka/blob/main/CLAUDE.md) — the full environment variable table and product invariants referenced throughout this page.
