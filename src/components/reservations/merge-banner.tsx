"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";

import { mergeGuestReservationsAction } from "@/app/reserve/actions";
import { AlertBanner } from "@/components/ui/banner";
import { InfoToast } from "@/components/ui/toast";

/**
 * Guest → account conversion prompt (DESIGN_BRIEF §6.5 / §6.7): this device
 * still carries a guest identity holding live bookings, and the person behind
 * it is now signed in. Offer to move them over once.
 *
 * "Не сейчас" is remembered in sessionStorage, not localStorage or the server:
 * the offer should stop nagging on every navigation, but it is worth making
 * again next time they come back — the bookings are still stranded on a cookie
 * that will eventually expire.
 */

const DISMISSED_KEY = "wishka-merge-prompt-dismissed";

/**
 * The dismissal flag as an external store: sessionStorage is not React state,
 * and reading it in an effect would mean a setState cascade on every mount.
 * The listener set also keeps two banners on one page (list + /people) in sync.
 */
const listeners = new Set<() => void>();

function subscribeToDismissal(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function isDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Hidden during SSR: the flag is unknowable there, and flashing a prompt the
 *  visitor already declined is worse than showing it a beat late. */
function isDismissedOnServer(): boolean {
  return true;
}

function dismissForSession(): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Storage disabled — the prompt simply reappears on the next page.
  }
  for (const listener of listeners) listener();
}

export type MergeBannerProps = {
  /** Live guest bookings found on this device. The banner renders nothing at 0. */
  count: number;
  className?: string;
};

export function MergeBanner({ count, className }: MergeBannerProps) {
  const t = useTranslations("myReservations");
  const router = useRouter();

  const dismissed = useSyncExternalStore(
    subscribeToDismissal,
    isDismissed,
    isDismissedOnServer,
  );
  const [busy, setBusy] = useState(false);
  const [merged, setMerged] = useState(false);

  async function handleMerge() {
    if (busy) return;
    setBusy(true);
    const result = await mergeGuestReservationsAction();
    setBusy(false);
    if (!result.ok) return;
    setMerged(true);
    router.refresh();
  }

  return (
    <>
      {!dismissed && !merged && count > 0 && (
        /* Both actions live in `children`: AlertBanner has a single action
           slot, and this prompt needs an accept *and* a decline. */
        <AlertBanner tone="info" className={className}>
          <span className="flex flex-wrap items-center justify-between gap-x-3">
            <span className="min-w-0 flex-1">{t("mergeFound", { count })}</span>
            <span className="flex flex-none items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleMerge()}
                className="min-h-11 cursor-pointer font-semibold underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("mergeCta")}
              </button>
              <button
                type="button"
                onClick={dismissForSession}
                className="min-h-11 cursor-pointer font-medium text-mute underline-offset-2 hover:underline"
              >
                {t("mergeLater")}
              </button>
            </span>
          </span>
        </AlertBanner>
      )}

      <InfoToast
        open={merged}
        message={t("mergedToast")}
        onDismiss={() => setMerged(false)}
      />
    </>
  );
}
