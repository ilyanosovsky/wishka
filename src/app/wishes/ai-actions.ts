"use server";

import type {
  AiQuotaSnapshot,
  AiResult,
  SuggestionInput,
  WishDraft,
} from "@/lib/ai/types";
import type { WishImageStatus } from "@/db/access/types";

export type { AiQuotaSnapshot, AiResult, SuggestionInput, WishDraft };

/**
 * Phase 6 AI server actions. Every action follows the same discipline:
 * resolve the session first, consume the daily quota second (server-side —
 * the UI counter is advisory), call the model third, and resolve — never
 * throw — so no AI failure can ever block the form (invariant #3).
 *
 * NOTE: contract stubs — implementation lands with the Phase 6 core work.
 */

const NOT_IMPLEMENTED = "Phase 6 core implementation pending";

/** «Добавь словами»: free text → structured wish draft. Consumes 1 `text`. */
export async function draftWishFromTextAction(
  text: string,
): Promise<AiResult<WishDraft>> {
  void text;
  throw new Error(NOT_IMPLEMENTED);
}

/** Description suggestion for the wish form. Consumes 1 `text`. */
export async function suggestDescriptionAction(
  input: SuggestionInput,
): Promise<AiResult<{ description: string }>> {
  void input;
  throw new Error(NOT_IMPLEMENTED);
}

/** Price-range suggestion for the wish form. Consumes 1 `text`. */
export async function suggestPriceAction(
  input: SuggestionInput,
): Promise<AiResult<{ priceMin: string; priceMax?: string; currency?: string }>> {
  void input;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Starts the async image generation job for an owned wish (edit mode / retry
 * from a failed card). Consumes 1 `image`; the wish row's `imageStatus` is the
 * job state. Someone else's wish resolves as plain `error` exactly like a
 * missing one — no ownership oracle.
 */
export async function generateWishImageAction(
  wishId: string,
): Promise<AiResult<null>> {
  void wishId;
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Owner-only poll target for cards in `generating`: returns the current image
 * state, or null for a missing/foreign wish (same shape — no oracle).
 */
export async function getWishImageStateAction(
  wishId: string,
): Promise<{ imageStatus: WishImageStatus; imageUrl: string | null } | null> {
  void wishId;
  throw new Error(NOT_IMPLEMENTED);
}

/** Read-only quota snapshot for UI counters; never increments anything. */
export async function getAiQuotaAction(): Promise<AiQuotaSnapshot> {
  throw new Error(NOT_IMPLEMENTED);
}
