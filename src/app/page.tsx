import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";

/** Temporary smoke screen: proves tokens, fonts, themes and i18n work. */
export default async function Home() {
  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col gap-6 px-6 pt-14 pb-10">
      {/* Masthead — ledger style: serif title over a heavy ink rule */}
      <header className="border-b-2 border-ink pb-4">
        <h1
          className="font-serif text-[27px] font-semibold tracking-[-0.01em]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {t("app.title")}
        </h1>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute-2">
          {t("home.status")} · {t("home.wishesCount", { count: 0 })} ·
          WISHKA.APP
        </p>
      </header>

      <p className="text-mute">{t("app.tagline")}</p>
      <p>{t("home.underConstruction")}</p>

      <section className="flex flex-col items-start gap-3 border border-rule-2 bg-paper p-4 shadow-[var(--shadow-line)]">
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
