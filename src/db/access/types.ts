/**
 * DTOs for the two mutually exclusive reading roles.
 *
 * The split is the product's core privacy rule: an owner reads their own list
 * through `OwnerWish`, which has no field that could carry reservation data,
 * and everyone else reads it through `ViewerWish`, which does. There is no DTO
 * that is both.
 */

export type WishType = "product" | "experience" | "service" | "certificate";
export type WishImageStatus = "none" | "ready" | "generating" | "failed";
export type WishPriceType = "none" | "exact" | "range";
export type WishPriority = "want" | "nice" | "idea";
export type WishVisibility = "everyone" | "restricted";
export type WishStatus = "active" | "gifted";

/** What the list owner sees. Nothing here is derived from reservation data. */
export type OwnerWish = {
  id: string;
  ownerId: string;
  type: WishType;
  title: string;
  url: string | null;
  imageKey: string | null;
  imageStatus: WishImageStatus;
  description: string | null;
  priceType: WishPriceType;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  priority: WishPriority;
  isDream: boolean;
  category: string | null;
  notes: string | null;
  visibility: WishVisibility;
  status: WishStatus;
  giftedAt: Date | null;
  /** Free text the owner typed, never a reserver identity. */
  giftedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReservationStatus = "free" | "reserved" | "reserved_by_you";

/** What anyone other than the owner sees. */
export type ViewerWish = {
  id: string;
  ownerId: string;
  type: WishType;
  title: string;
  url: string | null;
  imageKey: string | null;
  imageStatus: WishImageStatus;
  description: string | null;
  priceType: WishPriceType;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  priority: WishPriority;
  isDream: boolean;
  category: string | null;
  notes: string | null;
  createdAt: Date;
  reservationStatus: ReservationStatus;
};

/** Someone actually reading a list: a signed-in user, a device-cookie guest,
 *  or a passer-by. Only these can hold a booking. */
export type RealViewer =
  { userId: string } | { guestId: string } | { anonymous: true };

/**
 * The identity a view-as preview replays (§6.6). The guest lens is
 * `{ anonymous: true }` — a guest cookie unlocks nothing a passer-by cannot see.
 *
 * `{ groupId }` is "as any member of this group sees it" and carries no
 * identity on purpose: simulating one arbitrary real member would also pick up
 * wishes that member is named in individually, which is not what the owner
 * asked to see.
 */
export type PreviewIdentity =
  { userId: string } | { groupId: string } | { anonymous: true };

/**
 * The owner replaying somebody else's sight of their own list.
 *
 * The simulated identity is WRAPPED rather than passed bare so that all three
 * lenses — guest, group, person — are recognisable by shape alone: a bare
 * `{ userId }` person lens is indistinguishable from that person really reading
 * the list, and the reservation-free guards in `viewer.ts` would let it through.
 * Wrapped, a preview also cannot satisfy `Reserver`, so it can never hold or be
 * matched against a booking.
 */
export type PreviewViewer = { previewAs: PreviewIdentity };

/** Who is reading someone else's list. */
export type Viewer = RealViewer | PreviewViewer;

/** Who is holding, or wants to hold, a reservation. */
export type Reserver = { userId: string } | { guestId: string };
