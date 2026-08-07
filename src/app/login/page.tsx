import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { getAuth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/");

  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-6 pt-10 pb-10">
      <div className="self-end">
        <LocaleSwitcher />
      </div>

      <header className="mt-10 mb-8 border-b-2 border-ink pb-4">
        <h1
          className="font-serif text-[27px] font-semibold tracking-[-0.01em]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {t("app.title")}
        </h1>
        <p className="mt-1 text-mute">{t("app.tagline")}</p>
      </header>

      <LoginForm />

      <footer className="mt-auto pt-10 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-mute-2">
        WISHKA.APP · OPEN SOURCE
      </footer>
    </main>
  );
}
