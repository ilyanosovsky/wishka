import { getTranslations } from "next-intl/server";
import { ServiceScreen } from "@/components/service-screen";
import { loginHrefWithNext } from "@/lib/next-param";

/**
 * §6.10 service screen for an expired session. Landing target for flows that
 * want to explain *why* they're bouncing to /login rather than doing it
 * silently; the CTA forwards a validated `?next=` so sign-in returns here.
 */
export default async function SessionExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getTranslations();
  const { next } = await searchParams;

  return (
    <ServiceScreen
      title={t("service.sessionExpiredTitle")}
      ctaLabel={t("service.sessionExpiredCta")}
      ctaHref={loginHrefWithNext(next ?? "/")}
    />
  );
}
