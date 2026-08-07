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
          // Drafts are per-user data — never leave them for the next account
          // on a shared device.
          for (const key of Object.keys(window.localStorage)) {
            if (key.startsWith("wishka-wish-draft")) {
              window.localStorage.removeItem(key);
            }
          }
          router.refresh();
        })
      }
      className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-4 text-[13px] font-medium hover:bg-bg"
    >
      {t("signOut")}
    </button>
  );
}
