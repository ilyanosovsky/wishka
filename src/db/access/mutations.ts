import { and, eq } from "drizzle-orm";

import { isCategoryKey } from "@/lib/categories";
import { extractStorageKey } from "@/lib/storage/uploadthing";
import type { Db } from "../index";
import { wishes } from "../schema";
import { isUuid } from "./ids";
import type { OwnerWish, WishPriceType, WishPriority, WishType } from "./types";

/**
 * Owner-scoped wish writes.
 *
 * SURPRISE INVARIANT — like `owner.ts`, this module touches exactly one table
 * and returns the owner DTO. Nothing here reads, writes or returns booking
 * state, so no write path can leak who reserved what. `gifted_by` is free text
 * the owner types; it is never derived from a reserver. A test asserts this
 * file's source never names the booking table.
 *
 * OWNERSHIP — every update/delete carries `owner_id = ownerId` in its WHERE.
 * A wish id belonging to someone else is indistinguishable from a missing one
 * (`not_found` / `false` / `null`), so ids are not an enumeration oracle.
 */

/** Mirrors the column list in `owner.ts`: an explicit allow-list, so a future
 *  column cannot slip into the owner DTO just by existing on the table. */
const columns = {
  id: wishes.id,
  ownerId: wishes.ownerId,
  type: wishes.type,
  title: wishes.title,
  url: wishes.url,
  imageKey: wishes.imageKey,
  imageStatus: wishes.imageStatus,
  description: wishes.description,
  priceType: wishes.priceType,
  priceMin: wishes.priceMin,
  priceMax: wishes.priceMax,
  currency: wishes.currency,
  priority: wishes.priority,
  isDream: wishes.isDream,
  category: wishes.category,
  notes: wishes.notes,
  visibility: wishes.visibility,
  status: wishes.status,
  giftedAt: wishes.giftedAt,
  giftedBy: wishes.giftedBy,
  createdAt: wishes.createdAt,
  updatedAt: wishes.updatedAt,
};

/**
 * Which field the form should highlight. Deliberately small and stable — the
 * wish form maps each member to one visible control.
 *
 * `type` doubles as the code for an out-of-range `priority`: priority is a
 * radio group that cannot produce an invalid value from the UI, so it only
 * fails when something hand-crafts a server-action payload, and the form has
 * no separate slot to light up.
 */
export type WishValidationError =
  "title" | "price" | "currency" | "image" | "type" | "category" | "url";

/**
 * What the form sends. `imageUrl` is a URL on *our* storage host (an upload or
 * a re-hosted copy) — foreign hosts are rejected, product invariant #6.
 */
export type WishInput = {
  type: WishType;
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  priceType: WishPriceType;
  priceMin?: string | null;
  priceMax?: string | null;
  currency?: string | null;
  priority: WishPriority;
  isDream: boolean;
  category?: string | null;
  notes?: string | null;
};

export type WishMutationResult =
  | { ok: true; wish: OwnerWish }
  | { ok: false; error: WishValidationError | "not_found" };

const TITLE_MAX = 200;
const WISH_TYPES: readonly WishType[] = [
  "product",
  "experience",
  "service",
  "certificate",
];
const PRICE_TYPES: readonly WishPriceType[] = ["none", "exact", "range"];
const PRIORITIES: readonly WishPriority[] = ["want", "nice", "idea"];

/** numeric(12, 2) — anything above this overflows the column. */
const PRICE_MAX = 9_999_999_999.99;
/** Digits with at most two decimals; `,` accepted as the decimal separator
 *  only (so "1,5" is 1.5 while "1,400" is rejected rather than read as 1.4). */
const AMOUNT_RE = /^\d{1,10}([.,]\d{1,2})?$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * `unknown` on purpose: these values arrive through a server action, where the
 * declared `WishInput` type is a hope, not a guarantee. A hand-crafted payload
 * has to come back as a validation error, never a 500 out of `.trim()`.
 */
function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The stored `url` is rendered as an `<a href>` on the detail screen and, from
 * Phase 7, on other people's screens. Only http(s) survives — `javascript:`
 * and `data:` here would be stored XSS aimed at everyone who opens the list.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns the canonical `numeric` string, or null when unusable. */
function parseAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.replace(/[\s ]/g, "");
  if (!raw || !AMOUNT_RE.test(raw)) return null;
  const amount = Number(raw.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > PRICE_MAX) {
    return null;
  }
  return amount.toFixed(2);
}

/** The subset of columns a wish form owns. `visibility` and `status` are not
 *  here: they are moved by their own flows (Phase 8 / markGifted). */
type WishValues = {
  type: WishType;
  title: string;
  url: string | null;
  imageKey: string | null;
  imageStatus: "none" | "ready";
  description: string | null;
  priceType: WishPriceType;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  priority: WishPriority;
  isDream: boolean;
  category: string | null;
  notes: string | null;
};

type Validated =
  { ok: true; values: WishValues } | { ok: false; error: WishValidationError };

function validate(input: WishInput): Validated {
  const title = trimmedOrNull(input.title);
  if (title === null || title.length > TITLE_MAX) {
    return { ok: false, error: "title" };
  }

  if (!WISH_TYPES.includes(input.type)) return { ok: false, error: "type" };
  if (!PRIORITIES.includes(input.priority)) return { ok: false, error: "type" };

  const category = trimmedOrNull(input.category);
  if (category !== null && !isCategoryKey(category)) {
    return { ok: false, error: "category" };
  }

  const url = trimmedOrNull(input.url);
  if (url !== null && !isHttpUrl(url)) return { ok: false, error: "url" };

  if (!PRICE_TYPES.includes(input.priceType)) {
    return { ok: false, error: "price" };
  }

  let priceMin: string | null = null;
  let priceMax: string | null = null;
  let currency: string | null = null;

  if (input.priceType !== "none") {
    priceMin = parseAmount(input.priceMin);
    if (priceMin === null) return { ok: false, error: "price" };

    if (input.priceType === "range") {
      priceMax = parseAmount(input.priceMax);
      if (priceMax === null || Number(priceMax) < Number(priceMin)) {
        return { ok: false, error: "price" };
      }
    }

    const code = trimmedOrNull(input.currency);
    if (code === null || !CURRENCY_RE.test(code)) {
      return { ok: false, error: "currency" };
    }
    currency = code.toUpperCase();
  }

  /**
   * IMAGE — invariant #6. `image_key` holds the *URL* of the copy sitting on
   * our own CDN, not a bare storage key: that is what the card renders, and
   * `extractStorageKey(url)` recovers the key when the file has to be deleted.
   * Anything that is not one of our hosts (i.e. a hotlink to a shop's CDN) is
   * refused here rather than silently stored.
   */
  const imageUrl = trimmedOrNull(input.imageUrl);
  if (imageUrl !== null && extractStorageKey(imageUrl) === null) {
    return { ok: false, error: "image" };
  }

  return {
    ok: true,
    values: {
      type: input.type,
      title,
      url,
      imageKey: imageUrl,
      imageStatus: imageUrl === null ? "none" : "ready",
      description: trimmedOrNull(input.description),
      priceType: input.priceType,
      priceMin,
      priceMax,
      currency,
      priority: input.priority,
      isDream: Boolean(input.isDream),
      category,
      notes: trimmedOrNull(input.notes),
    },
  };
}

export async function createWish(
  db: Db,
  ownerId: string,
  input: WishInput,
): Promise<WishMutationResult> {
  const validated = validate(input);
  if (!validated.ok) return validated;

  const [wish] = await db
    .insert(wishes)
    .values({ ownerId, ...validated.values })
    .returning(columns);
  return { ok: true, wish };
}

/** The stored row seen as form input, so a partial update can be validated as
 *  a whole wish (e.g. setting `priceType: "range"` keeps the existing bounds). */
function toInput(wish: OwnerWish): WishInput {
  return {
    type: wish.type,
    title: wish.title,
    url: wish.url,
    imageUrl: wish.imageKey,
    description: wish.description,
    priceType: wish.priceType,
    priceMin: wish.priceMin,
    priceMax: wish.priceMax,
    currency: wish.currency,
    priority: wish.priority,
    isDream: wish.isDream,
    category: wish.category,
    notes: wish.notes,
  };
}

/** `undefined` means "leave alone"; clearing a field takes an explicit `null`. */
function merge(base: WishInput, patch: Partial<WishInput>): WishInput {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<WishInput>;
  return { ...base, ...defined };
}

export async function updateWish(
  db: Db,
  ownerId: string,
  wishId: string,
  input: Partial<WishInput>,
): Promise<WishMutationResult> {
  if (!isUuid(wishId)) return { ok: false, error: "not_found" };

  const [existing] = await db
    .select(columns)
    .from(wishes)
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .limit(1);
  if (!existing) return { ok: false, error: "not_found" };

  const validated = validate(merge(toInput(existing), input));
  if (!validated.ok) return validated;

  const [wish] = await db
    .update(wishes)
    .set({ ...validated.values, updatedAt: new Date() })
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .returning(columns);
  return wish ? { ok: true, wish } : { ok: false, error: "not_found" };
}

/**
 * Hard delete. The stored image is *not* removed here — file cleanup is a
 * Phase 5 concern and needs `extractStorageKey(wish.imageKey)` plus a storage
 * round-trip, which has no business inside a transactional delete.
 */
export async function deleteWish(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<boolean> {
  if (!isUuid(wishId)) return false;

  const deleted = await db
    .delete(wishes)
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .returning({ id: wishes.id });
  return deleted.length > 0;
}

/**
 * "Уже подарили" → the archive. `giftedBy` is whatever the owner typed and
 * nothing else: never a reserver, never a suggestion derived from one.
 */
export async function markGifted(
  db: Db,
  ownerId: string,
  wishId: string,
  giftedBy: string | null,
): Promise<OwnerWish | null> {
  if (!isUuid(wishId)) return null;

  const [wish] = await db
    .update(wishes)
    .set({
      status: "gifted",
      giftedAt: new Date(),
      giftedBy: trimmedOrNull(giftedBy),
      updatedAt: new Date(),
    })
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .returning(columns);
  return wish ?? null;
}

/** Archive → live list. Idempotent: restoring an already-active wish just
 *  re-clears the (already empty) gifted fields. */
export async function restoreWish(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<OwnerWish | null> {
  if (!isUuid(wishId)) return null;

  const [wish] = await db
    .update(wishes)
    .set({
      status: "active",
      giftedAt: null,
      giftedBy: null,
      updatedAt: new Date(),
    })
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .returning(columns);
  return wish ?? null;
}
