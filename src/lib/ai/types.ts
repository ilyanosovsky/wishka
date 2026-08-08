import type { WishType } from "@/db/access/types";

/**
 * Shared shapes for the Phase 6 AI assists. Everything the model produces is
 * untrusted input: `toWishDraft()` in `draft.ts` is the only place raw model
 * output becomes one of these, and it validates every field on the way in.
 */

/** A structured wish draft assembled from the user's free-text description. */
export type WishDraft = {
  title?: string;
  type?: WishType;
  /** One of `CATEGORY_KEYS` (lib/categories.ts) — anything else is dropped. */
  category?: string;
  description?: string;
  priceMin?: string;
  priceMax?: string;
  /** ISO 4217, uppercase — only ever set alongside `priceMin`. */
  currency?: string;
};

/** Form context handed to the description/price suggestion prompts. */
export type SuggestionInput = {
  title: string;
  type: WishType;
  category?: string | null;
  url?: string | null;
  description?: string | null;
};

export type AiFailReason = "quota" | "unavailable" | "error";

/**
 * Every AI action resolves — never throws — so a failed or exhausted call can
 * only ever render an inline notice while the form stays fully usable
 * (product invariant #3). `remaining` feeds the "Осталось N" counters.
 */
export type AiResult<T> =
  | { ok: true; value: T; remaining: number }
  | { ok: false; reason: AiFailReason; remaining?: number };

/** Daily per-user budgets, surfaced to the UI next to each AI affordance. */
export type AiQuotaSnapshot = {
  text: number;
  image: number;
};
