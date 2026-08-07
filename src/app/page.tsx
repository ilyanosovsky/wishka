import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";

/** Temporary home: session smoke screen until Phase 4 brings "My list". */
export default async function Home() {
  const t = await getTranslations();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const profile = session ? await getProfile(getDb(), session.user.id) : null;
  // A signed-in user without a profile abandoned onboarding — send them back.
  if (session && !profile) redirect("/welcome");

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col gap-6 px-6 pt-14 pb-10">
      <header className="border-b-2 border-ink pb-4">
        <h1
          className="font-serif text-[27px] font-semibold tracking-[-0.01em]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {t("app.title")}
        </h1>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute-2">
          {t("home.status")} · {t("home.wishesCount", { count: 0 })} ·
          {profile ? ` /U/${profile.nickname.toUpperCase()}` : " WISHKA.APP"}
        </p>
      </header>

      {session ? (
        <section className="flex flex-col items-start gap-3">
          <p>{t("home.greeting", { name: session.user.name ?? "" })}</p>
          <SignOutButton />
        </section>
      ) : (
        <section className="flex flex-col items-start gap-3">
          <p className="text-mute">{t("app.tagline")}</p>
          <Link
            href="/login"
            className="min-h-11 border border-accent bg-accent px-4 py-3 text-[13px] font-medium text-paper hover:bg-accent-ink"
          >
            {t("home.signIn")}
          </Link>
        </section>
      )}

      <section className="mt-auto flex flex-col items-start gap-3 border border-rule-2 bg-paper p-4 shadow-[var(--shadow-line)]">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">
          {t("theme.label")}
        </span>
        <ThemeSwitcher />
        <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-mute">
          {t("locale.label")}
        </span>
        <LocaleSwitcher />
      </section>
    </main>
  );
}
