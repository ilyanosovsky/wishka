"use client";

import { useLocale, useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import { isCategoryKey } from "@/lib/categories";
import { formatPrice } from "@/lib/price";
import {
  DreamStamp,
  NullPill,
  PriorityFlag,
  StatusBadge,
  VisibilityLockBadge,
  type WishPriority,
  type WishStatus,
} from "./badges";

export type WishImageStatus = "none" | "ready" | "generating" | "failed";
export type WishPriceType = "none" | "exact" | "range";
export type ReservationStatus = "free" | "reserved" | "reserved_by_you";

export type BaseWish = {
  title: string;
  imageUrl?: string | null;
  imageStatus: WishImageStatus;
  category?: string | null;
  priceType: WishPriceType;
  /** numeric columns come back from the driver as strings */
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  priority: WishPriority;
  isDream: boolean;
};

type WishCardCommon = {
  wish: BaseWish;
  onRetryImage?: () => void;
  onUploadImage?: () => void;
  onClick?: () => void;
  /** Disables the retry button while a retry for this wish is already in
   *  flight — guards against a double-tap burning two image-generation
   *  credits on the same card. Ignored on non-owner cards, which never
   *  render the retry affordance in the first place. */
  retryBusy?: boolean;
};

/**
 * Surprise invariant, enforced by the type system: the `owner` variant has no
 * slot for reservation data at all, so no owner-facing screen can render
 * anything derived from it — not even by accident. Covered by wish-card.test.tsx.
 */
export type WishCardProps =
  | (WishCardCommon & { role: "owner"; restrictedVisibility?: boolean })
  | (WishCardCommon & { role: "viewer"; reservationStatus: ReservationStatus })
  | (WishCardCommon & {
      role: "archive";
      giftedAt?: string | null;
      giftedBy?: string | null;
    });

/** Diagonal ledger hatching used wherever a product photo is missing. */
const PLACEHOLDER_STRIPES =
  "repeating-linear-gradient(45deg, var(--zebra) 0 10px, color-mix(in srgb, var(--rule) 35%, var(--zebra)) 10px 20px)";

const RESERVATION_TO_STATUS: Record<ReservationStatus, WishStatus> = {
  free: "free",
  reserved: "reserved",
  reserved_by_you: "reservedByYou",
};

const SHIMMER =
  "linear-gradient(90deg, var(--zebra) 0%, color-mix(in srgb, var(--rule) 45%, var(--zebra)) 40%, var(--zebra) 80%)";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function stopped(handler?: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handler?.();
  };
}

export function WishCard(props: WishCardProps) {
  const { wish, onClick, onRetryImage, onUploadImage, retryBusy } = props;
  const t = useTranslations("wish");
  const locale = useLocale();

  // The generating shimmer and the failed retry/upload affordances are
  // owner-only (Phase 6 §6.2 is an owner-facing async image lifecycle) — a
  // viewer or archive card has no use for either and must not swallow its
  // own click behind the failed card's stopPropagation buttons, so both
  // states fall through to the ordinary no-photo placeholder for them.
  const isOwner = props.role === "owner";

  const reserved =
    props.role === "viewer" && props.reservationStatus === "reserved";
  const reservedByYou =
    props.role === "viewer" && props.reservationStatus === "reserved_by_you";
  const archived = props.role === "archive";
  const dimmed = reserved || archived;

  const price = formatPrice(wish);
  const hasImage = wish.imageStatus === "ready" && Boolean(wish.imageUrl);

  /** Owner is absent by construction — there is no status for them to see. */
  const status: WishStatus | null =
    props.role === "viewer"
      ? RESERVATION_TO_STATUS[props.reservationStatus]
      : archived
        ? "gifted"
        : null;

  const statusBadge = status && (
    <StatusBadge
      size="sm"
      className="absolute top-1.5 left-1.5 z-10"
      status={status}
      label={t(`status.${status}`)}
    />
  );

  const giftedMeta = archived
    ? formatGiftedMeta(props, locale, (name) => t("giftedBy", { name }))
    : null;

  return (
    <div
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cx(
        "flex flex-col border text-left",
        archived ? "border-rule bg-zebra" : "bg-paper",
        !archived &&
          (reservedByYou
            ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]"
            : "border-rule-2"),
        reserved && "opacity-[.86]",
        onClick && "cursor-pointer",
      )}
    >
      {/* Keyframes live with the component: globals.css is owned elsewhere. */}
      <style href="wishka-wish-card" precedence="default">
        {
          "@keyframes wishka-shimmer{0%{background-position:-180px 0}100%{background-position:180px 0}}"
        }
      </style>

      <div className="relative aspect-[4/5] overflow-hidden">
        {isOwner && wish.imageStatus === "generating" ? (
          <div
            className="flex h-full w-full items-end justify-center pb-2.5"
            style={{
              background: SHIMMER,
              backgroundSize: "180px 100%",
              animation: "wishka-shimmer 1.2s linear infinite",
            }}
          >
            <span className="font-mono text-[9.5px] text-mute-2">
              {t("imageGenerating")}
            </span>
          </div>
        ) : isOwner && wish.imageStatus === "failed" ? (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2"
            style={{ background: PLACEHOLDER_STRIPES }}
          >
            <span className="sr-only">{t("imageFailed")}</span>
            {wish.category && (
              <span className="font-mono text-[9px] tracking-[var(--track-label)] text-mute-2 uppercase">
                {isCategoryKey(wish.category)
                  ? t(`category.${wish.category}`)
                  : wish.category}
              </span>
            )}
            <button
              type="button"
              disabled={retryBusy}
              onClick={stopped(onRetryImage)}
              className={cx(
                "min-h-11 cursor-pointer border border-[var(--green-rule)] bg-accent-soft px-2.5 text-[10px] font-semibold text-accent",
                retryBusy && "cursor-not-allowed opacity-60",
              )}
            >
              {t("retry")}
            </button>
            <button
              type="button"
              onClick={stopped(onUploadImage)}
              className="min-h-11 cursor-pointer border border-rule-2 px-2.5 text-[10px] font-medium text-mute"
            >
              {t("uploadPhoto")}
            </button>
          </div>
        ) : hasImage ? (
          /* eslint-disable-next-line @next/next/no-img-element -- images are
             re-hosted to our own storage; no next/image loader is configured. */
          <img
            src={wish.imageUrl ?? undefined}
            alt=""
            loading="lazy"
            className={cx(
              "h-full w-full object-cover",
              archived && "opacity-75 grayscale-[50%]",
            )}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ background: PLACEHOLDER_STRIPES }}
          >
            {wish.category && (
              <span className="font-mono text-[10px] tracking-[var(--track-stamp)] text-mute-2 uppercase">
                {wish.category}
              </span>
            )}
          </div>
        )}

        {statusBadge}

        {wish.isDream && (
          <DreamStamp
            size="sm"
            label={t("dream")}
            /* drops below the status badge, which can span most of the width */
            className={cx(
              "absolute right-1.5 z-10",
              statusBadge ? "top-[34px]" : "top-2.5",
            )}
          />
        )}

        {reserved && (
          <div aria-hidden className="absolute inset-0 bg-paper/25" />
        )}

        {props.role === "owner" && props.restrictedVisibility && (
          <VisibilityLockBadge
            label={t("restrictedVisibility")}
            className="absolute right-1.5 bottom-1.5 z-10"
          />
        )}
      </div>

      <div className="flex flex-col gap-[5px] px-[9px] pt-2 pb-2.5">
        <h3
          className={cx(
            "line-clamp-2 font-serif text-[13.5px] leading-[1.25] font-semibold",
            dimmed && "text-mute",
          )}
        >
          {wish.title}
        </h3>

        {archived ? (
          giftedMeta && (
            <div className="font-mono text-[9px] text-mute-2">{giftedMeta}</div>
          )
        ) : (
          // One line for every card: the flag uses the SHORT priority labels
          // (wish.priorityCard.*) so price + flag fit at any grid width — the
          // full labels wouldn't, and both wrapping and stacking left
          // neighbouring cards visibly inconsistent. The flag may truncate as
          // a last resort so nothing can bleed past the card border.
          <div className="flex items-center justify-between gap-[5px]">
            {price ? (
              <span
                className={cx(
                  "flex-none border border-rule px-[5px] py-0.5 font-mono text-[11px] font-medium whitespace-nowrap",
                  reserved && "text-mute",
                )}
              >
                {price}
              </span>
            ) : (
              <NullPill size="sm" label={t("noPrice")} />
            )}
            <PriorityFlag
              size="sm"
              priority={wish.priority}
              label={t(`priorityCard.${wish.priority}`)}
              className="min-w-0 truncate"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** "12.05.2026 · от Маши" — both halves optional. */
function formatGiftedMeta(
  props: Extract<WishCardProps, { role: "archive" }>,
  locale: string,
  giftedByLabel: (name: string) => string,
): string | null {
  const parts: string[] = [];
  if (props.giftedAt) {
    const date = new Date(props.giftedAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(
        new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(date),
      );
    }
  }
  if (props.giftedBy) parts.push(giftedByLabel(props.giftedBy));
  return parts.length ? parts.join(" · ") : null;
}
