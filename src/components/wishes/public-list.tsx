"use client";

import { ChevronDown, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { MergeBanner } from "@/components/reservations/merge-banner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { NoGiftChip, TagChip } from "@/components/ui/chip";
import { AppTabBar } from "@/components/app-tab-bar";
import { Tabs } from "@/components/ui/tabs";
import { WishCard } from "@/components/ui/wish-card";
import type { ViewerWish } from "@/db/access/types";
import { loginHrefWithNext } from "@/lib/next-param";
import { ShareSheet } from "./share-sheet";
import { toBaseWish } from "./wish-card-props";

/**
 * Someone else's list — which is also their profile (DESIGN_BRIEF §6.5).
 *
 * Renders `ViewerWish`, so it carries `reservationStatus` and every card is
 * `role="viewer"`. A guest (no session) gets the ledger stripped of app chrome:
 * a top banner instead of the tab bar, and no FAB. 7a wires the "free only"
 * filter but shows no reserve action — that arrives in 7b.
 */

export type PublicListProps = {
  /** The owner's display name (§6.5) — header, banners, empty states. Never
   *  the nickname: that is a URL segment, not what a person is called. */
  name: string;
  /** The owner's avatar on our own storage, if they uploaded one. */
  image?: string | null;
  /** Drives the `/u/<nickname>` share link. */
  nickname: string;
  wishes: ViewerWish[];
  sizes: Record<string, string>;
  tastes: string[];
  noGift: string[];
  /** No session behind this view — show the guest banner, hide the tab bar. */
  isGuest: boolean;
  /** Live guest bookings still held by this device's cookie while the viewer
   *  is signed in — > 0 offers to move them into the account (§6.5). */
  mergeCount?: number;
};

type FilterKey = "all" | "free";

/** Built-in size slots map to their labels; a user's own custom slot is its
 *  own label. */
const SIZE_LABEL_KEY: Record<string, string> = {
  clothing: "params.sizeClothing",
  shoes: "params.sizeShoes",
  ring: "params.sizeRing",
  head: "params.sizeHead",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export function PublicList({
  name,
  image = null,
  nickname,
  wishes,
  sizes,
  tastes,
  noGift,
  isGuest,
  mergeCount = 0,
}: PublicListProps) {
  const t = useTranslations();
  const router = useRouter();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [shareOpen, setShareOpen] = useState(false);

  const visible = useMemo(
    () =>
      filter === "free"
        ? wishes.filter((wish) => wish.reservationStatus === "free")
        : wishes,
    [wishes, filter],
  );

  const sizeEntries = Object.entries(sizes);
  const hasWhatMatters =
    sizeEntries.length > 0 || tastes.length > 0 || noGift.length > 0;

  return (
    <main
      className={`mx-auto flex min-h-dvh max-w-105 flex-col px-5 ${
        isGuest ? "pb-16" : "pb-32"
      }`}
    >
      {isGuest && (
        <div className="-mx-5 flex flex-wrap items-center justify-between gap-2 border-b border-rule-2 bg-zebra px-5 py-2.5">
          <span className="text-[12px] text-mute">
            {t("publicList.guestBanner", { name })}
          </span>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Button
              variant="primary"
              /* Signing up from someone's list should land back on that list,
                 not on an empty home screen. */
              onClick={() => router.push(loginHrefWithNext(`/u/${nickname}`))}
            >
              {t("publicList.createOwn")}
            </Button>
          </div>
        </div>
      )}

      <header
        className={`flex items-center gap-3 pb-3 [border-bottom:3px_double_var(--ink)] ${
          isGuest ? "pt-5" : "pt-14"
        }`}
      >
        <Avatar src={image} name={name} />
        <div className="min-w-0 flex-1">
          <h1
            className="truncate font-serif text-[21px] font-semibold tracking-[-0.01em]"
            style={{ lineHeight: "var(--lead-tight)" }}
          >
            {name}
          </h1>
          <p className="mt-px truncate font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
            {t("home.wishesCount", { count: wishes.length })}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("share.title")}
          onClick={() => setShareOpen(true)}
          className="flex h-11 w-11 flex-none items-center justify-center border border-rule-2 bg-paper text-mute"
        >
          <Share2 aria-hidden size={16} strokeWidth={2.4} />
        </button>
      </header>

      {mergeCount > 0 && <MergeBanner count={mergeCount} className="mt-3.5" />}

      {hasWhatMatters && (
        <WhatMatters sizes={sizeEntries} tastes={tastes} noGift={noGift} />
      )}

      {wishes.length > 0 && (
        <div className="pt-3.5">
          <Tabs
            value={filter}
            onChange={(value) => setFilter(value as FilterKey)}
            items={[
              { value: "all", label: t("publicList.filterAll") },
              { value: "free", label: t("publicList.filterFree") },
            ]}
          />
        </div>
      )}

      {wishes.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="font-serif text-[19px] font-semibold">
            {t("publicList.emptyOwner", { name })}
          </p>
          {!isGuest && (
            <p className="max-w-72 text-mute">
              {t("publicList.emptyOwnerHint")}
            </p>
          )}
        </section>
      ) : visible.length === 0 ? (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="font-serif text-[17px] font-semibold">
            {t("publicList.allReserved")}
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-3.5 pt-3.5">
          {visible.map((wish) => (
            <WishCard
              key={wish.id}
              role="viewer"
              reservationStatus={wish.reservationStatus}
              /* WishCard prints `category` verbatim in the no-photo
                 placeholder, so it gets the label, not the stored key. */
              wish={{
                ...toBaseWish(wish),
                category: wish.category
                  ? t(`wish.category.${wish.category}`)
                  : null,
              }}
              onClick={() => router.push(`/w/${wish.id}`)}
            />
          ))}
        </div>
      )}

      {!isGuest && <AppTabBar />}

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        url={`${APP_URL}/u/${nickname}`}
        kind="list"
      />
    </main>
  );
}

/** Collapsed "Что важно знать" — sizes, tastes and "не дарить" (§6.5). */
function WhatMatters({
  sizes,
  tastes,
  noGift,
}: {
  sizes: [string, string][];
  tastes: string[];
  noGift: string[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-3.5 border border-rule-2 bg-paper">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 text-left"
      >
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-mute uppercase">
          {t("publicList.whatMatters")}
        </span>
        <ChevronDown
          aria-hidden
          size={16}
          strokeWidth={2.4}
          className={`flex-none text-mute transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3.5 border-t border-dashed border-rule-2 px-3.5 py-3">
          {sizes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
                {t("publicList.sizes")}
              </h3>
              <dl className="flex flex-col gap-1">
                {sizes.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule-2 pb-1 last:border-b-0 last:pb-0"
                  >
                    <dt className="text-[13px] text-mute">
                      {SIZE_LABEL_KEY[key] ? t(SIZE_LABEL_KEY[key]) : key}
                    </dt>
                    <dd className="font-mono text-[13px] font-medium">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {tastes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
                {t("publicList.tastes")}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {tastes.map((taste) => (
                  <TagChip key={taste}>{taste}</TagChip>
                ))}
              </div>
            </div>
          )}

          {noGift.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[10.5px] font-semibold tracking-[0.1em] text-mute-2 uppercase">
                {t("publicList.noGift")}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {noGift.map((item) => (
                  <NoGiftChip key={item}>{item}</NoGiftChip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
