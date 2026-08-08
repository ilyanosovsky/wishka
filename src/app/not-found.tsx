import { getTranslations } from "next-intl/server";
import { ServiceScreen } from "@/components/service-screen";

/**
 * App-wide 404 (Phase 9 prod-readiness audit, finding #3). Next renders this
 * for any route that doesn't match a segment and for explicit `notFound()`
 * calls without a closer `not-found.tsx` — the one screen every visitor can
 * land on by mistyping a URL, so it goes through the same localized
 * `ServiceScreen` pattern as `/access-denied` rather than Next's default.
 */
export default async function NotFound() {
  const t = await getTranslations();

  return (
    <ServiceScreen
      title={t("service.notFoundTitle")}
      ctaLabel={t("service.notFoundCta")}
      ctaHref="/"
    />
  );
}
