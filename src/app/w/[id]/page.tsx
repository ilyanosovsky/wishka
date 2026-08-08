import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { isLocale } from "@/i18n/config";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { ReservePanel } from "@/components/reserve/reserve-panel";
import { MergeBanner } from "@/components/reservations/merge-banner";
import { ServiceScreen } from "@/components/service-screen";
import {
  DreamStamp,
  NullPill,
  PriorityFlag,
  StatusBadge,
  type WishStatus,
} from "@/components/ui/badges";
import { getDb } from "@/db";
import { countActiveGuestReservations } from "@/db/access/guest-identities";
import { getPublicIdentityByUserId } from "@/db/access/public-identity";
import type { ReservationStatus } from "@/db/access/types";
import { getVisibleWish } from "@/db/access/viewer";
import { loginHrefWithNext } from "@/lib/next-param";
import { formatPrice } from "@/lib/price";
import { resolveGuestIdentity, resolveViewer } from "@/lib/viewer";

/**
 * Single-wish share target (DESIGN_BRIEF §6.8) — a wish opened by its own link,
 * seen the way a guest sees it. `getVisibleWish` applies the same visibility
 * rules as the list, so a restricted wish this viewer may not see (and a bad or
 * gifted id) both fall through to the invalid-link screen (§6.10).
 *
 * 7b adds the booking half: the status badge and `ReservePanel`. Both are
 * withheld from the list owner — `getVisibleWish` already flattens their own
 * wish to `free` (it never reads a reservation row for them), and showing a
 * hardcoded "Свободно" plus a «Забронирую» button on your own wish would be
 * noise at best and a hint at worst.
 */

const PLACEHOLDER_STRIPES =
  "repeating-linear-gradient(45deg, var(--zebra) 0 10px, color-mix(in srgb, var(--rule) 35%, var(--zebra)) 10px 20px)";

const RESERVATION_TO_STATUS: Record<ReservationStatus, WishStatus> = {
  free: "free",
  reserved: "reserved",
  reserved_by_you: "reservedByYou",
};

/**
 * Share-card metadata (§6.8). A link preview is rendered by whoever the link
 * was pasted to — a chat server, a crawler, someone not signed in — so the wish
 * is resolved as a plain passer-by (`{ anonymous: true }`, exactly what
 * `resolveViewer` returns with no session and no guest cookie). A restricted
 * wish therefore falls out as `null` and gets bare brand metadata: the card
 * cannot say more than the page would.
 *
 * Only title, description and the re-hosted image go in — invariant #6 keeps
 * the URL on our own storage, and nothing derived from a reservation (the
 * `reservationStatus` this read also carries) may ever appear here: the owner's
 * own wish links through the same route.
 *
 * `robots: index: false` — shared links are for the people they were sent to,
 * not for search engines (Phase 9 production-readiness audit, finding 1).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations();
  const generic: Metadata = {
    title: "Wishka",
    robots: { index: false, follow: false },
  };

  const wish = await getVisibleWish(getDb(), id, { anonymous: true });
  if (!wish) return generic;

  const description = wish.description ?? t("meta.description");
  const image =
    wish.imageStatus === "ready" && wish.imageKey ? wish.imageKey : null;

  return {
    ...generic,
    title: wish.title,
    description,
    openGraph: {
      type: "website",
      title: wish.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: wish.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function SharedWishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations();

  const db = getDb();
  const viewer = await resolveViewer(db);

  const wish = await getVisibleWish(db, id, viewer);
  if (!wish) {
    return (
      <ServiceScreen
        title={t("service.invalidLinkTitle")}
        ctaLabel={t("service.invalidLinkCta")}
        ctaHref="/"
      />
    );
  }

  // §6.5/§6.8 name the owner by their display name; the nickname only builds
  // the link back to their list.
  const owner = await getPublicIdentityByUserId(db, wish.ownerId);
  const ownerName = owner?.name ?? "";
  const listHref = owner ? `/u/${owner.nickname}` : "/";

  const rawLocale = await getLocale();
  const price = formatPrice(wish, isLocale(rawLocale) ? rawLocale : "en");
  const hasImage = wish.imageStatus === "ready" && Boolean(wish.imageKey);
  const viewerUserId = "userId" in viewer ? viewer.userId : null;
  const isGuest = viewerUserId === null;
  const isOwner = viewerUserId === wish.ownerId;
  const badgeStatus = RESERVATION_TO_STATUS[wish.reservationStatus];

  // Signed in but this device still holds a guest identity — the manage-booking
  // link lands here, so this is where a post-signup guest gets the merge offer.
  const guest = viewerUserId ? await resolveGuestIdentity(db) : null;
  const mergeCount =
    guest && viewerUserId
      ? await countActiveGuestReservations(db, guest.id, viewerUserId)
      : 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pb-16">
      {isGuest && (
        <div className="-mx-5 flex flex-wrap items-center justify-between gap-2 border-b border-rule-2 bg-zebra px-5 py-2.5">
          <span className="text-[12px] text-mute">
            {t("publicList.guestBanner", { name: ownerName })}
          </span>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Link
              href={loginHrefWithNext(`/w/${wish.id}`)}
              className="inline-flex min-h-11 items-center justify-center border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
            >
              {t("publicList.createOwn")}
            </Link>
          </div>
        </div>
      )}

      {mergeCount > 0 && <MergeBanner count={mergeCount} className="mt-4" />}

      <header
        className={`pb-3 [border-bottom:3px_double_var(--ink)] ${
          isGuest ? "pt-5" : "pt-14"
        }`}
      >
        <p className="font-mono text-[10px] tracking-[0.08em] text-mute uppercase">
          {t("publicList.fromList", { name: ownerName })}
        </p>
      </header>

      <article className="pt-4">
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
        </div>

        <h1
          className="pt-4 font-serif text-[24px] font-semibold tracking-[-0.01em]"
          style={{ lineHeight: "var(--lead-tight)" }}
        >
          {wish.title}
        </h1>

        <div className="mt-3.5 flex items-center justify-between gap-3 border-y border-rule py-2.5">
          {price ? (
            <span className="font-mono text-[18px] font-medium whitespace-nowrap">
              {price}
            </span>
          ) : (
            <NullPill label={t("wish.noPrice")} />
          )}
          <div className="flex items-center gap-2.5">
            {!isOwner && (
              <StatusBadge
                status={badgeStatus}
                label={t(`wish.status.${badgeStatus}`)}
              />
            )}
            <PriorityFlag
              priority={wish.priority}
              label={t(`wish.priority.${wish.priority}`)}
            />
          </div>
        </div>

        {wish.description && (
          <p
            className="pt-3.5 text-mute"
            style={{ lineHeight: "var(--lead-prose)" }}
          >
            {wish.description}
          </p>
        )}

        {wish.url && (
          /* A real link, styled as the kit's default Button (which renders a
             <button>, so it cannot be used here). */
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

        {!isOwner && (
          <ReservePanel
            wishId={wish.id}
            reservationStatus={wish.reservationStatus}
            isGuest={isGuest}
            listHref={listHref}
          />
        )}

        <Link
          href={listHref}
          className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-accent hover:underline"
        >
          {t("publicList.backToList", { name: ownerName })}
        </Link>
      </article>
    </main>
  );
}
