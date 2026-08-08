import { getTranslations } from "next-intl/server";
import { ServiceScreen } from "@/components/service-screen";

/**
 * §6.10 — "logged in, but this list is only visible to group members."
 * Not wired into any redirect yet (group-restricted visibility is Phase 8);
 * this is the landing target future phases can redirect to.
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
