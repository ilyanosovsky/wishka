import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getAuth } from "@/lib/auth";
import { sanitizeNickname } from "@/lib/nickname";
import { OnboardingForm } from "./onboarding-form";

export default async function WelcomePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const profile = await getProfile(getDb(), session.user.id);
  if (profile) redirect("/");

  const t = await getTranslations("auth.onboarding");

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-6 pt-14 pb-10">
      <header className="mb-8 border-b-2 border-ink pb-4">
        <h1
          className="font-serif text-[24px] font-semibold tracking-[-0.01em]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {t("title")}
        </h1>
        <p className="mt-1 text-mute">{t("subtitle")}</p>
      </header>

      <OnboardingForm
        defaultName={session.user.name ?? ""}
        defaultNickname={sanitizeNickname(
          session.user.email ?? session.user.name ?? "",
        )}
      />
    </main>
  );
}
