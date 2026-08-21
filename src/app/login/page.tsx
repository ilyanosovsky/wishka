import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getAuth } from "@/lib/auth";
import { sanitizeNextPath } from "@/lib/next-param";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const next = sanitizeNextPath((await searchParams).next);
  if (session) redirect(next);

  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-6 pt-10 pb-10 lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,1.1fr)] lg:content-center lg:gap-x-16 lg:px-8 lg:py-12">
      <div className="self-end lg:col-span-2 lg:mb-10 lg:justify-self-end">
        <LocaleSwitcher />
      </div>

      <header className="mt-10 mb-8 border-b-2 border-ink pb-4 lg:mt-0 lg:mb-0 lg:self-center lg:border-r-2 lg:border-b-0 lg:pr-16 lg:pb-0">
        <h1
          className="font-serif text-[27px] font-semibold tracking-[-0.01em] lg:text-[44px]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {t("app.title")}
        </h1>
        <p className="mt-1 text-mute">{t("app.tagline")}</p>
      </header>

      <div className="lg:border lg:border-rule-2 lg:bg-paper lg:p-8 lg:shadow-[var(--shadow-line)]">
        <LoginForm next={next} />
      </div>

      <footer className="mt-auto pt-10 text-center font-mono text-[10px] tracking-[0.08em] text-mute-2 uppercase lg:col-span-2 lg:mt-8">
        WISHKA.APP · OPEN SOURCE
      </footer>
    </main>
  );
}
