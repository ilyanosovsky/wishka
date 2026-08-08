import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppTabBar } from "@/components/app-tab-bar";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ParamsEditor } from "@/components/profile/params-editor";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Avatar } from "@/components/ui/avatar";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";

/** Identity + public parameters (§6.6) + settings. Partner block and
 *  "view as others" preview arrive with Phase 8. */
export default async function ProfilePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const profile = await getProfile(getDb(), session.user.id);
  if (!profile) redirect("/welcome");

  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col gap-6 px-6 pt-14 pb-28">
      <header className="flex items-center gap-4 border-b-2 border-ink pb-5">
        <Avatar
          size="lg"
          name={session.user.name ?? profile.nickname}
          src={session.user.image}
        />
        <div className="min-w-0">
          <h1 className="truncate font-serif text-[24px] font-semibold tracking-[-0.01em]">
            {session.user.name}
          </h1>
          <p className="truncate font-mono text-[12px] text-mute">
            wishka.app/u/{profile.nickname}
          </p>
        </div>
      </header>

      <p className="text-[12px] text-mute">{t("params.publicNote")}</p>

      <ParamsEditor
        initial={{
          sizes: profile.sizes,
          tastes: profile.tastes,
          noGift: profile.noGift,
        }}
      />

      <section className="flex flex-col gap-4 border border-rule-2 bg-paper p-4 shadow-[var(--shadow-line)]">
        <h2 className="font-mono text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute">
          {t("profile.settings")}
        </h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute">
            {t("theme.label")}
          </span>
          <ThemeSwitcher />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute">
            {t("locale.label")}
          </span>
          <LocaleSwitcher />
        </div>
        <SignOutButton />
      </section>

      <AppTabBar />
    </main>
  );
}
