import { getTranslations } from "next-intl/server";

import {
  ViewAsBanner,
  type ViewAsLens,
} from "@/components/profile/view-as-banner";
import { RecordListVisit } from "@/components/reservations/record-list-visit";
import { ServiceScreen } from "@/components/service-screen";
import { PublicList } from "@/components/wishes/public-list";
import { getDb } from "@/db";
import type { Db } from "@/db";
import { countActiveGuestReservations } from "@/db/access/guest-identities";
import { getProfileByNickname } from "@/db/access/profiles";
import type { Viewer } from "@/db/access/types";
import { getAudienceCandidates } from "@/db/access/visibility";
import { getVisibleWishes, getWishesAsSeenBy } from "@/db/access/viewer";
import { resolveGuestIdentity, resolveViewer } from "@/lib/viewer";

/**
 * A public list, which is also its owner's public profile (DESIGN_BRIEF §6.5).
 *
 * An unknown nickname reads as an invalid link (§6.10), never a 404 leak.
 *
 * SURPRISE INVARIANT — the owner opening their own `/u/<nick>` gets the
 * anonymous *preview* via `getWishesAsSeenBy`, which forces every wish to
 * `free`, not `getVisibleWishes({anonymous})`, which would join reservations
 * and show the owner who booked what. They have their real list at `/`.
 *
 * `?as=` (§6.6) only widens *which* lens that preview uses, and only for the
 * owner: it is read exclusively on the owner branch, and that branch never
 * calls `getVisibleWishes`. Anyone else's `?as=` is ignored entirely.
 */

/** The lens plus the viewer it replays — one value so the two can't drift. */
type Preview = { lens: ViewAsLens; viewer: Viewer };

/**
 * Resolves `?as=` against what the owner may actually look through: a group
 * they belong to, or a person from their own candidate list. Anything else —
 * a stale id, a hand-typed one, junk — falls back to the guest lens rather
 * than erroring, since a preview has nothing to protect but itself.
 */
async function resolvePreview(
  db: Db,
  ownerId: string,
  as: string,
): Promise<Preview> {
  const guest: Preview = {
    lens: { kind: "guest" },
    viewer: { anonymous: true },
  };
  if (as === "guest") return guest;

  const candidates = await getAudienceCandidates(db, ownerId);

  if (as.startsWith("group:")) {
    const id = as.slice("group:".length);
    const group = candidates.groups.find((candidate) => candidate.id === id);
    // The whole group, not one arbitrary member: a real member would also
    // carry whatever they are named in individually, which is not the
    // question the owner asked.
    return group
      ? { lens: { kind: "group", name: group.name }, viewer: { groupId: id } }
      : guest;
  }

  if (as.startsWith("user:")) {
    const id = as.slice("user:".length);
    const person = candidates.people.find(
      (candidate) => candidate.userId === id,
    );
    return person
      ? { lens: { kind: "person", name: person.name }, viewer: { userId: id } }
      : guest;
  }

  return guest;
}

export default async function PublicListPage({
  params,
  searchParams,
}: {
  params: Promise<{ nickname: string }>;
  searchParams: Promise<{ as?: string | string[] }>;
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

  const { as } = await searchParams;
  const requestedLens = isOwner && typeof as === "string" ? as : null;
  const preview = requestedLens
    ? await resolvePreview(db, profile.userId, requestedLens)
    : null;

  const wishes = isOwner
    ? await getWishesAsSeenBy(
        db,
        profile.userId,
        preview?.viewer ?? { anonymous: true },
      )
    : await getVisibleWishes(db, profile.userId, viewer);

  // Signed in, yet this device still carries a guest identity: the bookings
  // made before signing in are strandable, so offer to move them (§6.5).
  // Bookings on the user's OWN list are excluded — counting them would leak,
  // via the prompt's number, that reservations exist on their own wishes.
  // A preview is a lens on someone else's experience, so it carries none of
  // the viewer's own prompts.
  const guest =
    viewerUserId && !preview ? await resolveGuestIdentity(db) : null;
  const mergeCount =
    guest && viewerUserId
      ? await countActiveGuestReservations(db, guest.id, viewerUserId)
      : 0;

  return (
    <>
      {preview && (
        <ViewAsBanner lens={preview.lens} nickname={profile.nickname} />
      )}
      {/* Visitors only — the owner does not need a trail back to their own list. */}
      {!isOwner && (
        <RecordListVisit nickname={profile.nickname} name={profile.nickname} />
      )}
      <PublicList
        name={profile.nickname}
        nickname={profile.nickname}
        wishes={wishes}
        sizes={profile.sizes}
        tastes={profile.tastes}
        noGift={profile.noGift}
        isGuest={viewerUserId === null}
        mergeCount={mergeCount}
      />
    </>
  );
}
