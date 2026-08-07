"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { deleteWishAction, markGiftedAction } from "@/app/wishes/actions";
import {
  DreamStamp,
  NullPill,
  PriorityFlag,
  VisibilityLockBadge,
} from "@/components/ui/badges";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TagChip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { InfoToast, UndoToast } from "@/components/ui/toast";
import type { OwnerWish, WishType } from "@/db/access/types";
import { formatPrice } from "@/lib/price";

/**
 * Own wish detail (DESIGN_BRIEF §6.4).
 *
 * SURPRISE INVARIANT — the owner sees no hint that a wish is reserved: this
 * screen renders `OwnerWish`, which has no such field, and neither "Уже
 * подарили" nor delete warns about anything. `giftedBy` is free text the
 * owner types; it is never prefilled from a reserver.
 */

export type WishDetailProps = {
  wish: OwnerWish;
};

const TYPE_LABEL_KEY: Record<WishType, string> = {
  product: "form.typeProduct",
  experience: "form.typeExperience",
  service: "form.typeService",
  certificate: "form.typeCertificate",
};

const PLACEHOLDER_STRIPES =
  "repeating-linear-gradient(45deg, var(--zebra) 0 10px, color-mix(in srgb, var(--rule) 35%, var(--zebra)) 10px 20px)";

export function WishDetail({ wish }: WishDetailProps) {
  const t = useTranslations();
  const router = useRouter();
  const wishId = wish.id;

  const [giftOpen, setGiftOpen] = useState(false);
  const [giftedBy, setGiftedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);

  /** The delete is confirmed and its undo window is open. */
  const armedRef = useRef(false);
  /** The server call has gone out; never send it twice. */
  const sentRef = useRef(false);

  const price = formatPrice(wish);
  const hasImage = wish.imageStatus === "ready" && Boolean(wish.imageKey);
  /** Optimistic: the wish reads as gone the moment delete is confirmed. */
  const removed = undoOpen || deleting;

  async function confirmGifted() {
    setSaving(true);
    const result = await markGiftedAction(wishId, giftedBy.trim() || null);
    if (result.ok) {
      router.push("/");
      return;
    }
    // Don't pretend it worked: close the sheet and say so.
    setSaving(false);
    setGiftOpen(false);
    setFailed(true);
  }

  /**
   * Sends the delete at most once. Returns null when there is nothing to send
   * — undo already disarmed it, or it is already on the wire.
   */
  const sendDelete = useCallback(() => {
    if (!armedRef.current || sentRef.current) return null;
    armedRef.current = false;
    sentRef.current = true;
    return deleteWishAction(wishId);
  }, [wishId]);

  /**
   * Undo is a 5-second grace period, not a cancel-on-exit. Leaving the screen
   * (back link, tab bar, a link in the notes) unmounts the toast and its timer
   * without firing `onDismiss`, so the pending delete has to be committed here
   * too — otherwise a confirmed delete silently evaporates.
   */
  useEffect(
    () => () => {
      sendDelete();
    },
    [sendDelete],
  );

  /** The undo window closed untouched — only now is the delete real. */
  function commitDelete() {
    setUndoOpen(false);
    const sent = sendDelete();
    if (!sent) return;
    setDeleting(true);
    sent.then(
      (result) => {
        if (result.ok) {
          router.push("/");
          return;
        }
        sentRef.current = false;
        setDeleting(false);
        setFailed(true);
      },
      () => {
        sentRef.current = false;
        setDeleting(false);
        setFailed(true);
      },
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pt-14 pb-40">
      <div className="pb-3">
        <Link
          href="/"
          aria-label={t("tabs.list")}
          className="flex h-11 w-11 items-center justify-center border border-rule-2 bg-paper text-mute"
        >
          <ArrowLeft aria-hidden size={18} strokeWidth={2.4} />
        </Link>
      </div>

      <article className={removed ? "opacity-50" : undefined}>
        <div className="relative aspect-[4/3] w-full overflow-hidden border border-rule-2">
          {hasImage ? (
            /* eslint-disable-next-line @next/next/no-img-element -- images live
               on our own storage; no next/image loader is configured. */
            <img
              src={wish.imageKey ?? undefined}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ background: PLACEHOLDER_STRIPES }}
            >
              {wish.category && (
                <span className="font-mono text-[10px] tracking-[var(--track-stamp)] text-mute-2 uppercase">
                  {t(`wish.category.${wish.category}`)}
                </span>
              )}
            </div>
          )}

          {wish.isDream && (
            <DreamStamp
              label={t("wish.dream")}
              className="absolute top-3 right-3"
            />
          )}
          {wish.visibility === "restricted" && (
            <VisibilityLockBadge
              label={t("wish.restrictedVisibility")}
              className="absolute right-2 bottom-2"
            />
          )}
        </div>

        <h1
          className="pt-4 font-serif text-[24px] font-semibold tracking-[-0.01em]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {wish.title}
        </h1>

        <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
          <TagChip>{t(TYPE_LABEL_KEY[wish.type])}</TagChip>
          {wish.category && (
            <TagChip>{t(`wish.category.${wish.category}`)}</TagChip>
          )}
        </div>

        <div className="mt-3.5 flex items-center justify-between gap-3 border-y border-rule py-2.5">
          {price ? (
            <span className="font-mono text-[18px] font-medium whitespace-nowrap">
              {price}
            </span>
          ) : (
            <NullPill label={t("wish.noPrice")} />
          )}
          <PriorityFlag
            priority={wish.priority}
            label={t(`wish.priority.${wish.priority}`)}
          />
        </div>

        {wish.description && (
          <p
            className="pt-3.5 text-mute"
            style={{ lineHeight: "var(--lead-prose)" }}
          >
            {wish.description}
          </p>
        )}

        {wish.notes && (
          <section className="mt-3.5 border border-rule-2 bg-zebra p-3">
            <h2 className="text-[10.5px] font-semibold tracking-[0.1em] text-mute uppercase">
              {t("form.notesLabel")}
            </h2>
            <p className="pt-1.5" style={{ lineHeight: "var(--lead-prose)" }}>
              {wish.notes}
            </p>
          </section>
        )}

        {wish.url && (
          /* Styled as the kit's default Button; Button itself renders a
             <button>, and this has to be a real link. */
          <a
            href={wish.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 border border-rule-2 bg-paper px-4 text-[13px] font-medium text-ink hover:bg-bg"
          >
            <ExternalLink aria-hidden size={15} strokeWidth={2.4} />
            {t("detail.openInStore")}
          </a>
        )}
      </article>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-105 flex-col gap-2 border-t-2 border-ink bg-paper px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button disabled={removed} onClick={() => setGiftOpen(true)}>
          {t("detail.gifted")}
        </Button>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={removed}
            onClick={() => router.push(`/wishes/${wish.id}/edit`)}
          >
            {t("detail.edit")}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={removed}
            onClick={() => setDeleteOpen(true)}
          >
            {t("detail.delete")}
          </Button>
        </div>
      </div>

      <BottomSheet
        open={giftOpen}
        onClose={() => setGiftOpen(false)}
        title={t("detail.giftedTitle")}
        footer={
          <>
            <Button className="flex-1" onClick={() => setGiftOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              loading={saving}
              onClick={confirmGifted}
            >
              {t("detail.giftedConfirm")}
            </Button>
          </>
        }
      >
        <TextField
          label={t("detail.giftedWho")}
          value={giftedBy}
          onChange={(event) => setGiftedBy(event.target.value)}
        />
        <p className="pt-1.5 text-[11px] text-mute-2">
          {t("detail.giftedHint")}
        </p>
      </BottomSheet>

      <Dialog
        open={deleteOpen}
        title={t("detail.deleteTitle")}
        description={t("detail.deleteDesc")}
        onClose={() => setDeleteOpen(false)}
        actions={[
          {
            label: t("common.cancel"),
            tone: "neutral",
            onClick: () => setDeleteOpen(false),
          },
          {
            label: t("common.delete"),
            tone: "destructive",
            onClick: () => {
              setDeleteOpen(false);
              armedRef.current = true;
              sentRef.current = false;
              setUndoOpen(true);
            },
          },
        ]}
      />

      <UndoToast
        open={undoOpen}
        message={t("detail.deletedToast")}
        actionLabel={t("common.undo")}
        /* Disarm first: idempotent, and it makes the unmount commit a no-op. */
        onAction={() => {
          armedRef.current = false;
          setUndoOpen(false);
        }}
        onDismiss={commitDelete}
      />

      <InfoToast
        open={failed}
        message={t("common.actionFailed")}
        onDismiss={() => setFailed(false)}
      />
    </main>
  );
}
