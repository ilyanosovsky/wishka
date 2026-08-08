"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";

/**
 * §6.6 «выход (с подтверждением)». Signing out wipes this device's wish
 * drafts, so a mis-tap is destructive — same `Dialog` gate every other
 * destructive action on the profile screen goes through (delete-account,
 * delete-forever, leave-group).
 */
export function SignOutButton() {
  const t = useTranslations();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await authClient.signOut();
      // Drafts are per-user data — never leave them for the next account
      // on a shared device.
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("wishka-wish-draft")) {
          window.localStorage.removeItem(key);
        }
      }
      router.refresh();
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="min-h-11 cursor-pointer border border-rule-2 bg-paper px-4 text-[13px] font-medium hover:bg-bg"
      >
        {t("home.signOut")}
      </button>

      <Dialog
        open={confirmOpen}
        title={t("profile.signOutTitle")}
        description={t("profile.signOutBody")}
        onClose={() => {
          if (signingOut) return;
          setConfirmOpen(false);
        }}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => {
              if (signingOut) return;
              setConfirmOpen(false);
            },
          },
          {
            label: t("home.signOut"),
            tone: "destructive",
            onClick: () => void confirmSignOut(),
          },
        ]}
      />
    </>
  );
}
