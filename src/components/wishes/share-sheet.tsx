"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { InfoToast } from "@/components/ui/toast";

/**
 * The single "Поделиться" sheet (DESIGN_BRIEF §6.8), shared by a list and by a
 * single wish. It never brokers a reservation — 7a only hands out the link.
 *
 * A restricted wish gets a warning step first: the direct link bypasses
 * visibility, so the owner has to acknowledge that before it is revealed.
 */

export type ShareKind = "list" | "wish";

export type ShareSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Absolute when `NEXT_PUBLIC_APP_URL` is set, otherwise a `/u/…` path that
   *  `toAbsolute` completes against the current origin at click time. */
  url: string;
  /** Reserved for 7b, where a wish and a list share differently. */
  kind: ShareKind;
  restricted?: boolean;
};

/** A relative `url` prop becomes absolute only in the click handler, so the
 *  rendered markup stays identical on the server and the client. */
function toAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window !== "undefined") return `${window.location.origin}${url}`;
  return url;
}

export function ShareSheet({
  open,
  onClose,
  url,
  restricted = false,
}: ShareSheetProps) {
  const t = useTranslations("share");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // navigator.share is not knowable while rendering on the server; probe after
  // mount (indirection keeps this out of the effect body, per house style).
  useEffect(() => {
    const detect = () =>
      setCanNativeShare(
        typeof navigator !== "undefined" &&
          typeof navigator.share === "function",
      );
    detect();
  }, []);

  // Every close path (scrim, Escape, buttons) funnels through BottomSheet's
  // onClose, so resetting here re-asks a restricted share for its warning on
  // the next open — no separate effect needed.
  function close() {
    setRevealed(false);
    onClose();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(toAbsolute(url));
      setCopied(true);
    } catch {
      // Clipboard access can be denied (insecure context, permissions) — the
      // link is still on screen to copy by hand, so fail quietly.
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ url: toAbsolute(url) });
    } catch {
      // Cancelled or unsupported at call time — nothing to recover.
    }
  }

  const needsWarning = restricted && !revealed;

  return (
    <>
      <BottomSheet open={open} onClose={close} title={t("title")}>
        {needsWarning ? (
          <div className="flex flex-col gap-3 pb-1">
            <div>
              <p className="font-serif text-[15px] font-semibold">
                {t("restrictedWarningTitle")}
              </p>
              <p
                className="pt-1.5 text-[13px] text-mute"
                style={{ lineHeight: "var(--lead-prose)" }}
              >
                {t("restrictedWarningBody")}
              </p>
            </div>
            <Button variant="primary" onClick={() => setRevealed(true)}>
              {t("shareAnyway")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-1">
            <div className="border border-rule-2 bg-zebra px-3 py-2.5 font-mono text-[12px] break-all text-mute">
              {url}
            </div>
            <Button variant="primary" onClick={copyLink}>
              {t("copyLink")}
            </Button>
            {canNativeShare && (
              <Button onClick={nativeShare}>{t("shareVia")}</Button>
            )}
          </div>
        )}
      </BottomSheet>

      <InfoToast
        open={copied}
        message={t("copied")}
        onDismiss={() => setCopied(false)}
      />
    </>
  );
}
