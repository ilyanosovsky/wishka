"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { dismissReservationAction } from "@/app/reserve/actions";
import { Avatar } from "@/components/ui/avatar";
import { Dialog } from "@/components/ui/dialog";
import { InfoToast } from "@/components/ui/toast";
import type {
  MyReservation,
  MyReservationState,
  ReservationChangedField,
} from "@/db/access/my-reservations";
import { formatPrice } from "@/lib/price";

/**
 * One row of "My bookings" (DESIGN_BRIEF §6.7) — the reserver's own side of the
 * surprise, so unlike every owner-facing card this one may say "забронировано"
 * out loud.
 *
 * All four states come pre-derived from `getMyReservations`; this component
 * only chooses copy and which action the row offers. A live booking is
 * *released* (confirm dialog — someone else may be waiting for it), while a
 * settled one — deleted or already gifted — is merely *dismissed* from the
 * list, which needs no ceremony. Both go through the same
 * `dismissReservationAction`: by reservation id, because a deleted wish no
 * longer has an id to cancel by.
 */

/** Same ledger hatching WishCard uses when a wish has no photo. */
const PLACEHOLDER_STRIPES =
  "repeating-linear-gradient(45deg, var(--zebra) 0 10px, color-mix(in srgb, var(--rule) 35%, var(--zebra)) 10px 20px)";

const STATE_CHIP: Record<MyReservationState, string> = {
  active: "border-accent bg-accent text-paper",
  changed: "border-null-rule bg-null text-null-txt",
  deleted: "border-rule-2 bg-zebra text-mute",
  given: "border-ink bg-ink text-paper",
};

const FIELD_LABEL_KEY: Record<ReservationChangedField, string> = {
  title: "fieldTitle",
  price: "fieldPrice",
  url: "fieldUrl",
};

export type ReservationCardProps = {
  reservation: MyReservation;
};

export function ReservationCard({ reservation }: ReservationCardProps) {
  const t = useTranslations();
  const router = useRouter();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const { state } = reservation;
  // A settled row is a receipt, not a commitment — nothing left to release.
  const isLive = state === "active" || state === "changed";
  const price = formatPrice(reservation);
  // Only a live wish has a viewable page: `getVisibleWish` filters out gifted
  // and deleted wishes, so linking those would land on the invalid-link screen.
  const linkedWishId = isLive && reservation.wishId ? reservation.wishId : null;

  const chipLabel =
    state === "active"
      ? t("wish.status.reservedByYou")
      : state === "changed"
        ? t("myReservations.stateChanged")
        : state === "deleted"
          ? t("myReservations.stateDeleted")
          : t("myReservations.stateGiven");

  const changedFields = reservation.changedFields
    .map((field) => t(`myReservations.${FIELD_LABEL_KEY[field]}`))
    .join(", ");

  async function runDismiss() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await dismissReservationAction(reservation.id);
      setConfirmOpen(false);
      if (result.ok) router.refresh();
      else setFailed(true);
    } catch {
      // A rejected action (e.g. network) must still free the button and the
      // dialog, and tell the user something went wrong.
      setConfirmOpen(false);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const title = (
    <h3 className="line-clamp-2 font-serif text-[14px] leading-[1.25] font-semibold">
      {reservation.title}
    </h3>
  );

  return (
    <article className="flex gap-3 border border-rule-2 bg-paper p-2.5">
      <div className="aspect-[4/5] w-14 flex-none overflow-hidden border border-rule">
        {reservation.imageKey ? (
          /* eslint-disable-next-line @next/next/no-img-element -- images are
             re-hosted to our own storage; no next/image loader is configured. */
          <img
            src={reservation.imageKey}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="h-full w-full"
            style={{ background: PLACEHOLDER_STRIPES }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className={`self-start border px-2 py-[3px] text-[9px] font-semibold tracking-[var(--track-badge)] uppercase ${STATE_CHIP[state]}`}
        >
          {chipLabel}
        </span>

        {linkedWishId ? (
          <Link href={`/w/${linkedWishId}`} className="min-w-0">
            {title}
          </Link>
        ) : (
          title
        )}

        <OwnerLine owner={reservation.owner} />

        {price && (
          <span className="font-mono text-[11px] text-mute">{price}</span>
        )}

        {state === "changed" && (
          <div className="flex flex-col gap-0.5 text-[11.5px] leading-[1.4] text-mute">
            <span>
              {t("myReservations.changedFields", { fields: changedFields })}
            </span>
            {reservation.changedFields.includes("title") && (
              <span>
                {t("myReservations.wasTitled", {
                  title: reservation.reservedTitle,
                })}
              </span>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => (isLive ? setConfirmOpen(true) : void runDismiss())}
            className={`min-h-11 cursor-pointer px-2 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
              isLive ? "text-neg" : "text-mute"
            }`}
          >
            {isLive
              ? t("myReservations.unreserve")
              : t("myReservations.dismiss")}
          </button>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("reserve.unreserveTitle")}
        description={t("reserve.unreserveBody")}
        actions={[
          {
            label: t("common.cancel"),
            onClick: () => setConfirmOpen(false),
            tone: "neutral",
          },
          {
            label: t("reserve.unreserveCta"),
            onClick: () => void runDismiss(),
            tone: "destructive",
          },
        ]}
      />

      <InfoToast
        open={failed}
        message={t("common.actionFailed")}
        onDismiss={() => setFailed(false)}
      />
    </article>
  );
}

/** Whose list this booking sits on. Links to their public list only when they
 *  have a nickname — a profile without one has no public URL. */
function OwnerLine({ owner }: { owner: MyReservation["owner"] }) {
  const body = (
    <>
      <Avatar src={owner.image} name={owner.name} size="sm" />
      <span className="truncate text-[12px] text-mute">{owner.name}</span>
    </>
  );

  return owner.nickname ? (
    <Link
      href={`/u/${encodeURIComponent(owner.nickname)}`}
      className="flex min-w-0 items-center gap-2"
    >
      {body}
    </Link>
  ) : (
    <span className="flex min-w-0 items-center gap-2">{body}</span>
  );
}
