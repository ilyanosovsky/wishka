import type { MetadataRoute } from "next";

/**
 * Private-by-default posture (Phase 9 prod-readiness audit, finding #1):
 * every route that can carry personal data — the owner's own list/profile
 * screens, and the guest-facing share surfaces (`/u`, `/w`, `/g`) — is
 * disallowed here at the crawler level. `/` and `/login` are the only pages
 * meant to be discoverable.
 *
 * This covers the *listing* half of the fix; the *per-page* `noindex`
 * metadata (belt-and-suspenders — some crawlers ignore robots.txt for pages
 * linked from elsewhere) lives on the route files themselves: `/u/[nickname]`,
 * `/w/[id]`, `/g/[token]/confirm` and `/invite/[token]`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/wishes",
        "/profile",
        "/people",
        "/groups",
        "/archive",
        "/g/",
        "/u/",
        "/w/",
        // The token is a live 14-day join credential and the page names the
        // group before any session check — an invite pasted into a public
        // channel must not become a search result.
        "/invite/",
      ],
    },
  };
}
