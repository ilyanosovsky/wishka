import { getTranslations } from "next-intl/server";
import { ServiceScreen } from "@/components/service-screen";

/**
 * §6.10 — "logged in, but this list is only visible to group members."
 * Deliberately not wired into any redirect: Phase 8b decided group-restricted
 * visibility is enforced per-wish, not per-list — a viewer outside a wish's
 * audience simply never sees that row (`visibleTo()` in the data-access
 * layer filters it out of `getVisibleWish`/`getVisibleWishes`), while the
 * public list itself (`/u/<nickname>`) stays reachable with whatever subset
 * is visible to them, even an empty one. There is no "list-level" access
 * check left to redirect from. This screen is kept as the landing target for
 * a future flow that does want a "no access" state, but nothing routes here
 * today — that is accepted, not a gap.
 */
export default async function AccessDeniedPage() {
  const t = await getTranslations();

  return (
    <ServiceScreen
      title={t("service.noAccessTitle")}
      ctaLabel={t("service.noAccessCta")}
      ctaHref="/"
    />
  );
}
