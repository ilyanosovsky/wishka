import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Baseline CSP — permissive enough to never break the app, strict enough to
 * be worth having. Every allowance below is deliberate, see the inline notes.
 *  - `script-src 'unsafe-eval'` is dev-only: Next's dev server (Fast Refresh,
 *    the dev overlay) eval()s, the production bundle does not.
 *  - `'unsafe-inline'` on script/style: the app has no nonce/hash pipeline
 *    yet (next/font + the inline theme-init script in layout.tsx, plus
 *    Tailwind's inline `style={{}}` usage throughout `src/components/ui`);
 *    tightening this needs a nonce-based setup, tracked as a follow-up.
 *  - `img-src`: `*.ufs.sh` + `utfs.io` are UploadThing's file-read hosts
 *    (see `src/lib/storage/uploadthing.ts`'s own host-matching doc comment)
 *    — the only place re-hosted wish/avatar images are served from.
 *    `lh3.googleusercontent.com` is Google's avatar CDN: Better Auth stores
 *    the OAuth `picture` URL verbatim on `user.image`, and nothing re-hosts it
 *    yet, so a Google sign-up who never uploaded an avatar would otherwise get
 *    a CSP-blocked <img> on every public surface. Re-hosting it through
 *    `lib/storage/` (which is what invariant #6 actually wants) is a recorded
 *    backlog item; until then this entry keeps the avatar rendering. Note that
 *    only `img-src` accepts it — such a URL is never emitted into share-card
 *    metadata, see `generateMetadata` in `src/app/u/[nickname]/page.tsx`.
 *  - `base-uri` / `form-action` have NO fallback to `default-src` in CSP L3,
 *    so they are stated explicitly: with `script-src 'unsafe-inline'`
 *    conceded, these are the cheapest directives left that still stop an
 *    injected `<base href>` from re-pointing every relative URL, and stop an
 *    injected form from posting to an external origin.
 *  - `connect-src`: `*.uploadthing.com` covers both `api.uploadthing.com`
 *    (the SDK's control-plane calls) and `ingest.uploadthing.com` (where the
 *    browser PUTs the file bytes directly during upload); `*.ufs.sh` covers
 *    reads. Confirmed against `uploadthing`'s own default host config
 *    (`upload-builder` in `node_modules/uploadthing/dist`).
 *  - Google OAuth is a server-side redirect (Better Auth's `socialProviders`,
 *    see `src/lib/auth.ts`) — no browser-side popup/iframe, so no extra
 *    `frame-src`/`connect-src` entry is needed for it.
 */
function buildCsp(): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (process.env.NODE_ENV !== "production") scriptSrc.push("'unsafe-eval'");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "img-src": [
      "'self'",
      "https://*.ufs.sh",
      "https://utfs.io",
      "https://lh3.googleusercontent.com",
      "data:",
      "blob:",
    ],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'"],
    "connect-src": ["'self'", "https://*.ufs.sh", "https://*.uploadthing.com"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: buildCsp() },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
