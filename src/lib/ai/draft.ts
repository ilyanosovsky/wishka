import type { WishType } from "@/db/access/types";
import { isCategoryKey } from "@/lib/categories";
import { detectCurrency, normalizeAmount } from "@/lib/parse/price";
import type { WishDraft } from "./types";

/**
 * The border between the model and the wish form: raw JSON in, a `WishDraft`
 * out. Everything the model produced is hostile input — a prompt-injected page
 * or a creative answer can name a category that does not exist, a type the
 * database CHECK would reject, a 5000-character description, or a currency with
 * no price. Each of those is dropped here rather than in a component, so the
 * form only ever receives values `db/access/mutations.ts` would also accept.
 */

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 300;

const WISH_TYPES: readonly WishType[] = [
  "product",
  "experience",
  "service",
  "certificate",
];

function isWishType(value: unknown): value is WishType {
  return (
    typeof value === "string" &&
    (WISH_TYPES as readonly string[]).includes(value)
  );
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type RawDraft = {
  title?: unknown;
  type?: unknown;
  category?: unknown;
  description?: unknown;
  price_min?: unknown;
  price_max?: unknown;
  currency?: unknown;
};

/** Prices and their currency, shared by the draft and the price suggestion:
 *  a range needs both ends in order, and a currency needs a price to sit on. */
function toPrices(raw: {
  price_min?: unknown;
  price_max?: unknown;
  currency?: unknown;
}): { priceMin?: string; priceMax?: string; currency?: string } {
  const priceMin = normalizeAmount(raw.price_min);
  if (!priceMin) return {};

  const prices: { priceMin: string; priceMax?: string; currency?: string } = {
    priceMin,
  };
  const priceMax = normalizeAmount(raw.price_max);
  // A range needs both ends, and the top end must sit above the bottom.
  if (priceMax && Number(priceMax) > Number(priceMin)) {
    prices.priceMax = priceMax;
  }
  // `detectCurrency` is an allow-list of real codes, so "THE" or a symbol
  // hallucinated into the field cannot become a currency.
  const currency = detectCurrency(text(raw.currency));
  if (currency) prices.currency = currency;
  return prices;
}

/** Exported for tests: the model's answer is untrusted input like any other. */
export function toWishDraft(raw: unknown): WishDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const data = raw as RawDraft;

  const draft: WishDraft = {};

  const title = text(data.title);
  if (title) draft.title = title.slice(0, TITLE_MAX);

  if (isWishType(data.type)) draft.type = data.type;

  const category = text(data.category);
  if (isCategoryKey(category)) draft.category = category;

  const description = text(data.description);
  if (description) draft.description = description.slice(0, DESCRIPTION_MAX);

  return { ...draft, ...toPrices(data) };
}

/** A description suggestion, or null when the model returned nothing usable. */
export function toDescriptionSuggestion(
  raw: unknown,
): { description: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const description = text((raw as { description?: unknown }).description);
  if (!description) return null;
  return { description: description.slice(0, DESCRIPTION_MAX) };
}

/**
 * A price suggestion. `priceMin` is mandatory: the form fills the price block
 * from it, and a suggestion with only a currency or only an upper bound has
 * nothing to fill.
 */
export function toPriceSuggestion(
  raw: unknown,
): { priceMin: string; priceMax?: string; currency?: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prices = toPrices(raw as RawDraft);
  if (!prices.priceMin) return null;
  return { ...prices, priceMin: prices.priceMin };
}
