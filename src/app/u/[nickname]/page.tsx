import type { Metadata } from "next";
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
import {
  getPublicIdentityByNickname,
  getPublicIdentityByUserId,
} from "@/db/access/public-identity";
import type { PreviewViewer } from "@/db/access/types";
import { getAudienceCandidates } from "@/db/access/visibility";
import { getVisibleWishes, getWishesAsSeenBy } from "@/db/access/viewer";
import { extractStorageKey } from "@/lib/storage/uploadthing";
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

/**
 * The lens plus the identity it replays — one value so the two can't drift.
 * The identity is a `PreviewViewer`, so `getWishesAsSeenBy` is the only read it
 * fits and no lens can slip into a path that joins reservations.
 */
type Preview = { lens: ViewAsLens; viewer: PreviewViewer };

/** No `?as=`, or an unusable one: the owner's own list read as a passer-by. */
const GUEST_PREVIEW: PreviewViewer = { previewAs: { anonymous: true } };

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
    viewer: GUEST_PREVIEW,
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
      ? {
          lens: { kind: "group", name: group.name },
          viewer: { previewAs: { groupId: id } },
        }
      : guest;
  }

  if (as.startsWith("user:")) {
    const id = as.slice("user:".length);
    const person = candidates.people.find(
      (candidate) => candidate.userId === id,
    );
    return person
      ? {
          lens: { kind: "person", name: person.name },
          viewer: { previewAs: { userId: id } },
        }
      : guest;
  }

  return guest;
}

/**
 * Share-card metadata (§6.8 — these links are made to be pasted into a chat).
 * Only the owner's *public* identity goes in: display name and the avatar we
 * re-hosted ourselves. Never a wish, never a count, and never anything derived
 * from reservations — the owner opens this URL too.
 *
 * `robots: index: false` — a list is shared with the people its owner sends it
 * to, not with search engines (Phase 9 production-readiness audit, finding 1).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ nickname: string }>;
}): Promise<Metadata> {
  const { nickname } = await params;
  const identity = await getPublicIdentityByNickname(getDb(), nickname);
  const t = await getTranslations();

  // An unknown nickname renders the invalid-link screen; its card says nothing
  // about whether that nickname exists. `absolute` because the root layout's
  // `%s · Wishka` template would otherwise render "Wishka · Wishka".
  if (!identity) {
    return {
      title: { absolute: "Wishka" },
      robots: { index: false, follow: false },
    };
  }

  // A user who signed in by email and skipped onboarding has no name at all —
  // the nickname is the only thing that is never empty.
  const title = identity.name ?? identity.nickname;
  const description = t("meta.description");
  // Only an image on OUR storage may enter a share card. A Google OAuth avatar
  // is hotlinked on `user.image` today (see next.config.ts's img-src note);
  // putting it here would publish a Google CDN URL into every link preview.
  const image =
    identity.image && extractStorageKey(identity.image) ? identity.image : null;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "profile",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
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

  // §6.5 names the owner by their display name and avatar; the nickname stays
  // in the URL. The fallback is load-bearing, not defensive: an email signup
  // that skipped onboarding has no name (`getPublicIdentityByUserId` normalizes
  // the empty string to null), and the nickname is never empty.
  const identity = await getPublicIdentityByUserId(db, profile.userId);
  const displayName = identity?.name ?? profile.nickname;

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
        preview?.viewer ?? GUEST_PREVIEW,
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
      {preview && <ViewAsBanner lens={preview.lens} />}
      {/* Visitors only — the owner does not need a trail back to their own list. */}
      {!isOwner && (
        <RecordListVisit nickname={profile.nickname} name={displayName} />
      )}
      <PublicList
        name={displayName}
        image={identity?.image ?? null}
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
