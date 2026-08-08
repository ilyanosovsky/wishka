"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteAccountAction } from "@/app/profile/actions";
import { Dialog } from "@/components/ui/dialog";
import { InfoToast } from "@/components/ui/toast";

/**
 * Settings-section control (below sign-out). Destructive, so it goes through
 * `Dialog` rather than firing on tap — the copy in `account.deleteBody`
 * spells out the group-succession consequence up front, since nothing warns
 * anyone after the fact once this runs.
 *
 * A successful `deleteAccountAction` redirects server-side and never resolves
 * back into this component, so the only local state to manage is "in flight"
 * and "failed" — a leftover open dialog on failure lets the user retry or back
 * out without losing their place.
 */
export function DeleteAccount() {
  const t = useTranslations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirmDelete() {
    // A second tap while the first request is in flight would delete twice:
    // the second call fails on an already-deleted account and flashes a false
    // error over the first one's redirect.
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteAccountAction();
      if (!result.ok) {
        setDeleting(false);
        setConfirmOpen(false);
        setFailed(true);
      }
      // On success the action redirects — this component unmounts before a
      // resolved value would ever come back.
    } catch {
      setDeleting(false);
      setConfirmOpen(false);
      setFailed(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="min-h-11 cursor-pointer text-left text-[13px] font-medium text-neg"
      >
        {t("account.delete")}
      </button>

      <Dialog
        open={confirmOpen}
        title={t("account.deleteTitle")}
        description={t("account.deleteBody")}
        onClose={() => {
          if (deleting) return;
          setConfirmOpen(false);
        }}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => {
              if (deleting) return;
              setConfirmOpen(false);
            },
          },
          {
            label: deleting
              ? t("account.deleting")
              : t("account.deleteConfirm"),
            tone: "destructive",
            onClick: () => void confirmDelete(),
          },
        ]}
      />

      <InfoToast
        open={failed}
        message={t("account.deleteFailed")}
        onDismiss={() => setFailed(false)}
      />
    </>
  );
}
