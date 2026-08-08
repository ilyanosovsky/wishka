import type { MetadataRoute } from "next";

/**
 * Private-by-default posture (Phase 9 prod-readiness audit, finding #1):
 * every route that can carry personal data — the owner's own list/profile
 * screens, and the guest-facing share surfaces (`/u`, `/w`, `/g`) — is
 * disallowed here at the crawler level. `/` and `/login` are the only pages
 * meant to be discoverable.
 *
 * This covers the *listing* half of the fix; the *per-page* `noindex`
 * metadata for `/u/[nickname]` and `/w/[id]` (belt-and-suspenders — some
 * crawlers ignore robots.txt for pages linked from elsewhere) is owned by
 * the agent working those route files, tracked separately.
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
      ],
    },
  };
}
