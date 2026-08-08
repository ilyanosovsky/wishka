"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { GroupsTab } from "@/components/groups/groups-tab";
import { Tabs } from "@/components/ui/tabs";
import type { GroupSummary } from "@/db/access/groups";
import type { MyReservation } from "@/db/access/my-reservations";
import { MergeBanner } from "./merge-banner";
import { MyReservations } from "./my-reservations";

/**
 * «Люди» = two tabs (§6.7): groups and bookings. Client-side switching so the
 * (already fetched) data doesn't round-trip on every tap.
 *
 * The merge prompt sits above the tab strip: the bookings it would move belong
 * in this screen either way, so it should be visible whichever tab is open.
 */

type TabKey = "groups" | "reservations";

export type PeopleTabsProps = {
  groups: GroupSummary[];
  reservations: MyReservation[];
  /** Live guest bookings on this device; 0 hides the merge prompt. */
  mergeCount: number;
};

export function PeopleTabs({
  groups,
  reservations,
  mergeCount,
}: PeopleTabsProps) {
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
            {
              value: "groups",
              label: t("people.groupsTab"),
              count: groups.length,
            },
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
          <GroupsTab groups={groups} />
        ) : (
          <MyReservations reservations={reservations} />
        )}
      </div>
    </div>
  );
}
