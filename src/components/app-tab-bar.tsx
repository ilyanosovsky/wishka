"use client";

import { List, User, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { TabBar } from "@/components/ui/tab-bar";

/**
 * The app's fixed 3-tab nav. A client component on purpose: it owns the Lucide
 * icon references and i18n labels itself, so Server Components can render it
 * with no props. Passing icon components (functions) from a Server Component
 * into the "use client" TabBar crosses the RSC serialization boundary and
 * throws ("Functions cannot be passed directly to Client Components").
 */
export function AppTabBar() {
  const t = useTranslations("tabs");
  return (
    <TabBar
      ariaLabel={t("navLabel")}
      desktopBrand="Wishka"
      items={[
        { key: "list", label: t("list"), icon: List, href: "/" },
        { key: "people", label: t("people"), icon: Users, href: "/people" },
        { key: "profile", label: t("profile"), icon: User, href: "/profile" },
      ]}
    />
  );
}
