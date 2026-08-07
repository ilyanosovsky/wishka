import { headers } from "next/headers";
import { List, User, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TabBar } from "@/components/ui/tab-bar";
import { getAuth } from "@/lib/auth";

/** Placeholder until Phase 8 (groups) — keeps the tab bar honest. */
export default async function PeoplePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const t = await getTranslations("people");
  const tabs = await getTranslations("tabs");

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-6 pt-14 pb-28">
      <header className="border-b-2 border-ink pb-4">
        <h1 className="font-serif text-[24px] font-semibold tracking-[-0.01em]">
          {t("title")}
        </h1>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <p className="font-serif text-[17px] font-semibold">
          {t("emptyTitle")}
        </p>
        <p className="max-w-72 text-mute">{t("emptyBody")}</p>
      </section>
      <TabBar
        items={[
          { key: "list", label: tabs("list"), icon: List, href: "/" },
          {
            key: "people",
            label: tabs("people"),
            icon: Users,
            href: "/people",
          },
          {
            key: "profile",
            label: tabs("profile"),
            icon: User,
            href: "/profile",
          },
        ]}
      />
    </main>
  );
}
