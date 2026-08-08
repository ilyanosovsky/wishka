"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { adoptGuestTokenAction } from "./actions";

/**
 * The device-switch decision behind a manage-booking link when another guest
 * identity is already on this device. "Switch" adopts the token; "keep" just
 * follows the link without changing the cookie.
 */
export function SwitchPrompt({ token, next }: { token: string; next: string }) {
  const t = useTranslations("reserve");
  const [pending, start] = useTransition();

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="font-serif text-[19px] font-semibold">
        {t("switchTitle")}
      </h1>
      <p className="text-mute" style={{ lineHeight: "var(--lead-prose)" }}>
        {t("switchBody")}
      </p>
      <div className="flex w-full flex-col gap-3">
        <Button
          variant="primary"
          loading={pending}
          onClick={() => start(() => adoptGuestTokenAction(token, next))}
        >
          {t("switchConfirm")}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => start(() => adoptGuestTokenAction("", next))}
        >
          {t("switchKeep")}
        </Button>
      </div>
    </main>
  );
}
