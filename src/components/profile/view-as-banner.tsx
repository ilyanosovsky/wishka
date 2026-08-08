"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The strip that sits above a `/u/<nickname>?as=…` preview (§6.6), so the
 * owner is never in doubt that they are looking through someone else's lens.
 *
 * `viewAs.note` states flatly that bookings are never shown in a preview —
 * unconditional copy, because the preview genuinely cannot show them
 * (`getWishesAsSeenBy` collapses every wish to `free`).
 */

export type ViewAsLens =
  | { kind: "guest" }
  | { kind: "group"; name: string }
  | { kind: "person"; name: string };

export type ViewAsBannerProps = {
  lens: ViewAsLens;
  /** Where «Выйти» goes — the same list without `?as=`. */
  nickname: string;
};

export function ViewAsBanner({ lens, nickname }: ViewAsBannerProps) {
  const t = useTranslations("viewAs");

  const label =
    lens.kind === "guest"
      ? t("bannerGuest")
      : lens.kind === "group"
        ? t("bannerGroup", { name: lens.name })
        : t("bannerPerson", { name: lens.name });

  return (
    <div className="border-b border-rule-2 bg-zebra px-5 py-2.5">
      <div className="mx-auto flex max-w-105 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium">{label}</p>
          <p className="truncate text-[11px] text-mute">{t("note")}</p>
        </div>
        <Link
          href={`/u/${nickname}`}
          className="text-[12px] font-medium text-accent underline"
        >
          {t("exit")}
        </Link>
      </div>
    </div>
  );
}
