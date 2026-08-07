"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("home");
  const router = useRouter();

  return (
    <button
      onClick={() =>
        void authClient.signOut().then(() => {
          router.refresh();
        })
      }
      className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-4 text-[13px] font-medium hover:bg-bg"
    >
      {t("signOut")}
    </button>
  );
}
