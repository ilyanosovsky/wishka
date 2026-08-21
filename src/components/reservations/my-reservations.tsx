"use client";

import { useTranslations } from "next-intl";

import type { MyReservation } from "@/db/access/my-reservations";
import { RecentLists } from "./recent-lists";
import { ReservationCard } from "./reservation-card";

/**
 * The "My bookings" tab body (§6.7): every booking this viewer holds across all
 * lists, the footnote explaining that owner edits arrive by email, and the way
 * back to lists they browsed.
 *
 * The recent-lists block sits here rather than above the cards on purpose — it
 * is the consolation prize for an empty list, and a footer for a full one.
 */
export function MyReservations({
  reservations,
}: {
  reservations: MyReservation[];
}) {
  const t = useTranslations("myReservations");

  return (
    <section className="flex flex-col">
      {reservations.length === 0 ? (
        <p className="py-10 text-center text-mute">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3">
          {reservations.map((reservation) => (
            <ReservationCard key={reservation.id} reservation={reservation} />
          ))}
        </div>
      )}

      <p className="pt-3 font-mono text-[10px] tracking-[0.08em] text-mute-2 uppercase">
        {t("emailsNote")}
      </p>

      <RecentLists />
    </section>
  );
}
