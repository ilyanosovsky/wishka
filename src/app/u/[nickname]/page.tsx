import { getTranslations } from "next-intl/server";

import { ServiceScreen } from "@/components/service-screen";
import { PublicList } from "@/components/wishes/public-list";
import { getDb } from "@/db";
import { getProfileByNickname } from "@/db/access/profiles";
import { getVisibleWishes, getWishesAsSeenBy } from "@/db/access/viewer";
import { resolveViewer } from "@/lib/viewer";

/**
 * A public list, which is also its owner's public profile (DESIGN_BRIEF §6.5).
 *
 * An unknown nickname reads as an invalid link (§6.10), never a 404 leak.
 *
 * SURPRISE INVARIANT — the owner opening their own `/u/<nick>` gets the
 * anonymous *preview* via `getWishesAsSeenBy`, which forces every wish to
 * `free`, not `getVisibleWishes({anonymous})`, which would join reservations
 * and show the owner who booked what. They have their real list at `/`.
 */
export default async function PublicListPage({
  params,
}: {
  params: Promise<{ nickname: string }>;
}) {
  const { nickname } = await params;
  const db = getDb();
  const profile = await getProfileByNickname(db, nickname);

  if (!profile) {
    const t = await getTranslations("service");
    return (
      <ServiceScreen
        title={t("invalidLinkTitle")}
        ctaLabel={t("invalidLinkCta")}
        ctaHref="/"
      />
    );
  }

  // A guest cookie makes the viewer a `guestId`, so their own bookings come
  // back as `reserved_by_you` — the same rule every reserve action resolves by.
  const viewer = await resolveViewer(db);
  const viewerUserId = "userId" in viewer ? viewer.userId : null;
  const isOwner = viewerUserId === profile.userId;

  const wishes = isOwner
    ? await getWishesAsSeenBy(db, profile.userId, { anonymous: true })
    : await getVisibleWishes(db, profile.userId, viewer);

  return (
    <PublicList
      name={profile.nickname}
      nickname={profile.nickname}
      wishes={wishes}
      sizes={profile.sizes}
      tastes={profile.tastes}
      noGift={profile.noGift}
      isGuest={viewerUserId === null}
    />
  );
}
