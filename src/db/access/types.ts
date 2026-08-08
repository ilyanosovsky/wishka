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

/**
 * Who is reading someone else's list.
 *
 * `{ groupId }` is the view-as lens — "as any member of this group sees it".
 * It carries no identity on purpose: simulating one arbitrary real member would
 * also pick up wishes that member is named in individually, which is not what
 * the owner asked to see. Being identity-less, it can never hold a booking,
 * which is why `Reserver` stays a separate union.
 */
export type Viewer =
  | { userId: string }
  | { guestId: string }
  | { groupId: string }
  | { anonymous: true };

/** Who is holding, or wants to hold, a reservation. */
export type Reserver = { userId: string } | { guestId: string };
