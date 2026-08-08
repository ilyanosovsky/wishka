import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { ServiceScreen } from "@/components/service-screen";
import { DreamStamp, NullPill, PriorityFlag } from "@/components/ui/badges";
import { getDb } from "@/db";
import { getProfile } from "@/db/access/profiles";
import { getVisibleWish } from "@/db/access/viewer";
import { formatPrice } from "@/lib/price";
import { resolveViewer } from "@/lib/viewer";

/**
 * Single-wish share target (DESIGN_BRIEF §6.8) — a wish opened by its own link,
 * seen the way a guest sees it. `getVisibleWish` applies the same visibility
 * rules as the list, so a restricted wish this viewer may not see (and a bad or
 * gifted id) both fall through to the invalid-link screen (§6.10).
 *
 * 7a shows the card only; the reserve action arrives in 7b.
 */

const PLACEHOLDER_STRIPES =
  "repeating-linear-gradient(45deg, var(--zebra) 0 10px, color-mix(in srgb, var(--rule) 35%, var(--zebra)) 10px 20px)";

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

  const ownerProfile = await getProfile(db, wish.ownerId);
  const ownerName = ownerProfile?.nickname ?? "";
  const listHref = ownerProfile ? `/u/${ownerProfile.nickname}` : "/";

  const price = formatPrice(wish);
  const hasImage = wish.imageStatus === "ready" && Boolean(wish.imageKey);
  const isGuest = !("userId" in viewer);

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
              href="/login"
              className="inline-flex min-h-11 items-center justify-center border border-accent bg-accent px-4 text-[13px] font-medium text-paper hover:bg-accent-ink"
            >
              {t("publicList.createOwn")}
            </Link>
          </div>
        </div>
      )}

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
