"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Tabs } from "@/components/ui/tabs";
import type { MyReservation } from "@/db/access/my-reservations";
import { MergeBanner } from "./merge-banner";
import { MyReservations } from "./my-reservations";

/**
 * «Люди» = two tabs (§6.7). Groups stay a placeholder until Phase 8; bookings
 * are live. Client-side switching so the (already fetched) bookings don't
 * round-trip on every tap.
 *
 * The merge prompt sits above the tab strip: the bookings it would move belong
 * in this screen either way, so it should be visible whichever tab is open.
 */

type TabKey = "groups" | "reservations";

export type PeopleTabsProps = {
  reservations: MyReservation[];
  /** Live guest bookings on this device; 0 hides the merge prompt. */
  mergeCount: number;
};

export function PeopleTabs({ reservations, mergeCount }: PeopleTabsProps) {
  const t = useTranslations();
  const [tab, setTab] = useState<TabKey>("groups");

  return (
    <div className="flex flex-1 flex-col">
      {mergeCount > 0 && <MergeBanner count={mergeCount} className="mt-3.5" />}

      <div className="pt-3.5">
        <Tabs
          value={tab}
          onChange={(value) => setTab(value as TabKey)}
          ariaLabel={t("people.title")}
          items={[
            { value: "groups", label: t("people.groupsTab") },
            {
              value: "reservations",
              label: t("people.reservationsTab"),
              count: reservations.length,
            },
          ]}
        />
      </div>

      <div className="flex flex-1 flex-col pt-3.5">
        {tab === "groups" ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <p className="font-serif text-[17px] font-semibold">
              {t("people.emptyTitle")}
            </p>
            <p className="max-w-72 text-mute">{t("people.emptyBody")}</p>
          </section>
        ) : (
          <MyReservations reservations={reservations} />
        )}
      </div>
    </div>
  );
}
