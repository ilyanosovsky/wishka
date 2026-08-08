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
  const [failed, setFailed] = useState(false);

  function closeConfirm() {
    if (signingOut) return;
    setConfirmOpen(false);
    setFailed(false);
  }

  /**
   * `authClient.signOut()` is better-fetch-backed: an HTTP failure *resolves*
   * with `{ data: null, error }` rather than throwing. Discarding that result
   * is how a failed sign-out used to wipe the drafts, close the dialog and
   * refresh the page while the session was still live — the exact opposite of
   * what this control promises on a shared device. So: revoke first, and only
   * then destroy anything.
   */
  async function confirmSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setFailed(false);
    try {
      const result = await authClient.signOut();
      if (result?.error) {
        // Still signed in — the drafts are still this user's own.
        setFailed(true);
        return;
      }
      // Drafts are per-user data — never leave them for the next account
      // on a shared device.
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("wishka-wish-draft")) {
          window.localStorage.removeItem(key);
        }
      }
      setConfirmOpen(false);
      router.refresh();
    } catch {
      // Hard rejection (offline, aborted request) — same posture: nothing was
      // revoked, so nothing gets deleted, and the dialog says so.
      setFailed(true);
    } finally {
      setSigningOut(false);
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
        error={failed ? t("common.actionFailed") : undefined}
        onClose={closeConfirm}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: closeConfirm,
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
