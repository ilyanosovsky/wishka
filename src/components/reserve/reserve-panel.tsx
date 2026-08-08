"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  cancelReservationAction,
  reserveWishAction,
} from "@/app/reserve/actions";
import { AlertBanner } from "@/components/ui/banner";
import { StatusBadge } from "@/components/ui/badges";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InfoToast, UndoToast } from "@/components/ui/toast";
import type { ReservationStatus } from "@/db/access/types";
import { GuestFormSheet } from "./guest-form-sheet";

/**
 * The booking control of `/w/<id>` (DESIGN_BRIEF §6.4/§6.5/§6.8).
 *
 * It is the only place that decides what a viewer may do with a wish that is
 * not theirs, and it is deliberately optimistic about *its own* status while
 * staying pessimistic about the server's answer: every action re-reads the page
 * (`router.refresh()`), and every losing race (someone booked first, the owner
 * deleted the wish) has its own exit rather than a generic error.
 *
 * Nothing here is ever rendered for the list owner — `/w/[id]` withholds the
 * panel entirely, so the surprise invariant holds by absence, not by branching.
 */

export type ReservePanelProps = {
  wishId: string;
  reservationStatus: ReservationStatus;
  /** No session behind this view — a guest identity may still be needed. */
  isGuest: boolean;
  /** The owner's list, where a losing race sends the viewer next. */
  listHref: string;
};

type Overlay =
  | { kind: "none" }
  | { kind: "confirm" }
  | { kind: "unreserve" }
  | { kind: "guest" }
  | { kind: "conflict" }
  | { kind: "gone" };

type Toast = { kind: "none" } | { kind: "reserved" } | { kind: "unreserved" };

export function ReservePanel({
  wishId,
  reservationStatus,
  isGuest,
  listHref,
}: ReservePanelProps) {
  const t = useTranslations();
  const router = useRouter();

  const [status, setStatus] = useState<ReservationStatus>(reservationStatus);
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [toast, setToast] = useState<Toast>({ kind: "none" });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // The server is the source of truth: whenever a refresh brings a new status
  // down, it wins over whatever this panel decided locally.
  const [lastStatus, setLastStatus] = useState(reservationStatus);
  if (reservationStatus !== lastStatus) {
    setLastStatus(reservationStatus);
    setStatus(reservationStatus);
  }

  function closeOverlay() {
    setOverlay({ kind: "none" });
  }

  /**
   * One reserve path for the confirm dialog and the undo toast alike — the
   * failure modes are identical, and undo losing the wish to someone else must
   * land in the same conflict sheet as a first attempt.
   */
  async function reserve() {
    // The dialog's CTA is a plain dialog button, not a <Button> that can go
    // `loading` — an impatient double tap would otherwise reserve twice and
    // read its own unique-index collision as "someone booked first".
    if (pending) return;
    setFailed(false);
    setPending(true);
    try {
      const result = await reserveWishAction(wishId);
      if (result.ok) {
        closeOverlay();
        setStatus("reserved_by_you");
        setToast({ kind: "reserved" });
        router.refresh();
        return;
      }
      if (result.reason === "need_guest") setOverlay({ kind: "guest" });
      else if (result.reason === "already_reserved") {
        setStatus("reserved");
        setOverlay({ kind: "conflict" });
      } else setOverlay({ kind: "gone" });
    } catch {
      closeOverlay();
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    try {
      const result = await cancelReservationAction(wishId);
      closeOverlay();
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setStatus("free");
      setToast({ kind: "unreserved" });
      router.refresh();
    } catch {
      closeOverlay();
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  function handleUndo() {
    setToast({ kind: "none" });
    void reserve();
  }

  return (
    <section className="mt-5 flex flex-col gap-3 border-t border-rule pt-4">
      {failed && (
        <AlertBanner tone="error">{t("common.actionFailed")}</AlertBanner>
      )}

      {status === "free" && (
        <Button
          variant="primary"
          className="w-full"
          loading={pending}
          onClick={() => setOverlay({ kind: "confirm" })}
        >
          {t("reserve.cta")}
        </Button>
      )}

      {status === "reserved_by_you" && (
        <>
          <StatusBadge
            className="self-start"
            status="reservedByYou"
            label={t("wish.status.reservedByYou")}
          />
          <Button
            variant="danger"
            className="w-full"
            loading={pending}
            onClick={() => setOverlay({ kind: "unreserve" })}
          >
            {t("reserve.unreserveCta")}
          </Button>
        </>
      )}

      {status === "reserved" && (
        <>
          <StatusBadge
            className="self-start"
            status="reserved"
            label={t("wish.status.reserved")}
          />
          <Link
            href={listHref}
            className="inline-flex min-h-11 items-center text-[13px] font-medium text-accent hover:underline"
          >
            {t("reserve.reservedElseHint")}
          </Link>
          {isGuest && (
            <p className="text-[12px] leading-[1.5] text-mute">
              {t("reserve.otherDeviceHint")}
            </p>
          )}
        </>
      )}

      <Dialog
        open={overlay.kind === "confirm"}
        title={t("reserve.confirmTitle")}
        description={t("reserve.confirmBody")}
        onClose={closeOverlay}
        actions={[
          { label: t("common.cancel"), tone: "neutral", onClick: closeOverlay },
          {
            label: t("reserve.confirmCta"),
            tone: "accent",
            onClick: () => void reserve(),
          },
        ]}
      />

      <Dialog
        open={overlay.kind === "unreserve"}
        title={t("reserve.unreserveTitle")}
        description={t("reserve.unreserveBody")}
        onClose={closeOverlay}
        actions={[
          { label: t("common.cancel"), tone: "neutral", onClick: closeOverlay },
          {
            label: t("reserve.unreserveCta"),
            tone: "destructive",
            onClick: () => void cancel(),
          },
        ]}
      />

      <Dialog
        open={overlay.kind === "gone"}
        title={t("reserve.goneTitle")}
        onClose={closeOverlay}
        actions={[
          {
            label: t("reserve.goneCta"),
            tone: "accent",
            onClick: () => {
              closeOverlay();
              router.push(listHref);
            },
          },
        ]}
      />

      <BottomSheet
        open={overlay.kind === "conflict"}
        onClose={closeOverlay}
        title={t("reserve.conflictTitle")}
      >
        <div className="flex flex-col gap-3.5">
          <p className="text-[13px] text-mute">{t("reserve.conflictBody")}</p>
          <Link
            href={listHref}
            onClick={closeOverlay}
            className="inline-flex min-h-11 w-full items-center justify-center border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
          >
            {t("reserve.conflictCta")}
          </Link>
        </div>
      </BottomSheet>

      <GuestFormSheet
        open={overlay.kind === "guest"}
        wishId={wishId}
        onClose={closeOverlay}
        onReserved={() => setStatus("reserved_by_you")}
        onDone={() => {
          closeOverlay();
          router.refresh();
        }}
        onConflict={() => {
          setStatus("reserved");
          setOverlay({ kind: "conflict" });
        }}
        onGone={() => setOverlay({ kind: "gone" })}
      />

      <InfoToast
        open={toast.kind === "reserved"}
        message={t("reserve.reservedToast")}
        onDismiss={() => setToast({ kind: "none" })}
      />

      <UndoToast
        open={toast.kind === "unreserved"}
        message={t("reserve.unreservedToast")}
        actionLabel={t("common.undo")}
        onAction={handleUndo}
        onDismiss={() => setToast({ kind: "none" })}
      />
    </section>
  );
}
