import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppTabBar } from "@/components/app-tab-bar";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { DeleteAccount } from "@/components/profile/delete-account";
import { ParamsEditor } from "@/components/profile/params-editor";
import { PartnerBlock } from "@/components/profile/partner-block";
import { ViewAsSheet } from "@/components/profile/view-as-sheet";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Avatar } from "@/components/ui/avatar";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAudienceCandidates } from "@/db/access/visibility";
import { getAuth } from "@/lib/auth";

/** Identity + public parameters (§6.6) + settings + partner + delete-account +
 *  "view as others" (Phase 8b). */
export default async function ProfilePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login?next=%2Fprofile");
  const db = getDb();
  const profile = await getProfile(db, session.user.id);
  if (!profile) redirect("/welcome");

  const t = await getTranslations();
  // Same candidate list the "Кому видно" people picker draws from (§6.3) —
  // the partner block reuses it rather than running its own group query.
  const candidates = await getAudienceCandidates(db, session.user.id);
  const partner = profile.partnerId
    ? (candidates.people.find((p) => p.userId === profile.partnerId) ?? null)
    : null;

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-mute">{t("params.publicNote")}</p>
        <ViewAsSheet nickname={profile.nickname} candidates={candidates} />
      </div>

      <ParamsEditor
        initial={{
          sizes: profile.sizes,
          tastes: profile.tastes,
          noGift: profile.noGift,
        }}
      />

      <PartnerBlock partner={partner} candidates={candidates.people} />

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
        <DeleteAccount />
      </section>

      <AppTabBar />
    </main>
  );
}
