"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Route-tree error boundary — the calm "couldn't load" state (§6.2). */
export default function RouteError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("list");

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-serif text-[19px] font-semibold">{t("loadError")}</p>
      <Button onClick={reset}>{t("retry")}</Button>
    </main>
  );
}
