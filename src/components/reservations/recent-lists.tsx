"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Avatar } from "@/components/ui/avatar";
import {
  getRecentListsServerSnapshot,
  readRecentLists,
  subscribeToRecentLists,
} from "@/lib/recent-lists";

/**
 * "Недавно просмотренные списки" (§6.7) — the way back to a list opened once
 * from a link. The trail lives in localStorage, so it is read through
 * `useSyncExternalStore`: the server snapshot is empty, hydration matches, and
 * the real list arrives on the client without a setState-in-effect cascade.
 */
export function RecentLists() {
  const t = useTranslations("myReservations");
  const entries = useSyncExternalStore(
    subscribeToRecentLists,
    readRecentLists,
    getRecentListsServerSnapshot,
  );

  if (entries.length === 0) return null;

  return (
    <section className="mt-4 border-t border-rule pt-3">
      <h2 className="font-mono text-[10px] tracking-[0.1em] text-mute-2 uppercase">
        {t("recentTitle")}
      </h2>
      <ul className="mt-1 flex flex-col">
        {entries.map((entry) => (
          <li key={entry.nickname}>
            <Link
              href={`/u/${encodeURIComponent(entry.nickname)}`}
              className="flex min-h-11 items-center gap-2.5 border-b border-dashed border-rule-2 last:border-b-0"
            >
              <Avatar name={entry.name} size="sm" />
              <span className="truncate text-[13px]">{entry.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
