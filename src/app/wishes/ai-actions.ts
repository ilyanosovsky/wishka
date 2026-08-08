"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getLocale } from "next-intl/server";

import { getDb } from "@/db";
import { getOwnerWish } from "@/db/access/owner";
import { getImageState } from "@/db/access/wish-image";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import {
  createOpenAiImageClient,
  createOpenAiTextClient,
} from "@/lib/ai/client";
import {
  toDescriptionSuggestion,
  toPriceSuggestion,
  toWishDraft,
} from "@/lib/ai/draft";
import {
  armImageGeneration,
  runImageGenerationJob,
  type ScheduledImageJob,
} from "@/lib/ai/image-job";
import {
  buildDescriptionPrompt,
  buildDraftPrompt,
  buildPricePrompt,
} from "@/lib/ai/prompts";
import { consumeAiQuota, getAiQuotaRemaining } from "@/lib/ai/quota";
import { getAuth } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { extractStorageKey } from "@/lib/storage/uploadthing";
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
 * The session lookup deliberately sits OUTSIDE each try/catch: `redirect()`
 * signals itself by throwing, and swallowing that would leave a signed-out
 * user staring at a generic error instead of the login page.
 */

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user.id;
}

/** The locale the answer must be written in. */
async function requestLocale(): Promise<Locale> {
  const locale = await getLocale();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * Hands the job to Vercel's `after()`: a FRESH database handle (the request's
 * is finished by then) and nothing allowed to escape — an unhandled rejection
 * in `after()` takes down the whole post-response phase.
 *
 * Deliberately not exported and deliberately duplicated in `actions.ts`: a
 * `"use server"` module may only export async functions, so a shared scheduler
 * would have to become a server action of its own.
 */
function scheduleImageJob(job: ScheduledImageJob): void {
  after(async () => {
    try {
      await runImageGenerationJob({ ...job, db: getDb() });
    } catch {
      // `runImageGenerationJob` already swallows everything; belt and braces.
    }
  });
}

/**
 * Drops a generated file whose wish never ended up pointing at it (the owner
 * uploaded their own photo mid-job, the wish was edited or deleted, a newer job
 * won). The URL comes from `storage.putBuffer`, so the key is always ours; a
 * URL we cannot read a key out of is left alone rather than guessed at.
 *
 * Duplicated in `actions.ts` for the same reason as the scheduler above.
 */
async function deleteStoredImage(url: string): Promise<void> {
  const key = extractStorageKey(url);
  if (key) await storage.delete(key);
}

/** A caller-supplied `SuggestionInput` arrives through a server action, where
 *  the declared type is a hope: a wish with no title has nothing to suggest
 *  from, and everything else the prompt builder clips itself. */
function usableInput(input: SuggestionInput): boolean {
  return typeof input?.title === "string" && input.title.trim().length > 0;
}

/** «Добавь словами»: free text → structured wish draft. Consumes 1 `text`. */
export async function draftWishFromTextAction(
  text: string,
): Promise<AiResult<WishDraft>> {
  const userId = await requireUserId();
  try {
    const client = createOpenAiTextClient();
    if (!client) return { ok: false, reason: "unavailable" };

    const freeText = typeof text === "string" ? text.trim() : "";
    if (!freeText) return { ok: false, reason: "error" };

    const db = getDb();
    if (!(await consumeAiQuota(db, userId, "text"))) {
      return { ok: false, reason: "quota", remaining: 0 };
    }
    const remaining = (await getAiQuotaRemaining(db, userId)).text;

    const raw = await client.complete(
      buildDraftPrompt(freeText, await requestLocale()),
    );
    const draft = toWishDraft(raw);
    // A draft with no title fills nothing the user could not see was empty;
    // it reads as a failure rather than an empty form claiming to be AI work.
    if (!draft.title) return { ok: false, reason: "error", remaining };

    return { ok: true, value: draft, remaining };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Description suggestion for the wish form. Consumes 1 `text`. */
export async function suggestDescriptionAction(
  input: SuggestionInput,
): Promise<AiResult<{ description: string }>> {
  const userId = await requireUserId();
  try {
    const client = createOpenAiTextClient();
    if (!client) return { ok: false, reason: "unavailable" };
    if (!usableInput(input)) return { ok: false, reason: "error" };

    const db = getDb();
    if (!(await consumeAiQuota(db, userId, "text"))) {
      return { ok: false, reason: "quota", remaining: 0 };
    }
    const remaining = (await getAiQuotaRemaining(db, userId)).text;

    const raw = await client.complete(
      buildDescriptionPrompt(input, await requestLocale()),
    );
    const suggestion = toDescriptionSuggestion(raw);
    if (!suggestion) return { ok: false, reason: "error", remaining };

    return { ok: true, value: suggestion, remaining };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Price-range suggestion for the wish form. Consumes 1 `text`. */
export async function suggestPriceAction(
  input: SuggestionInput,
): Promise<
  AiResult<{ priceMin: string; priceMax?: string; currency?: string }>
> {
  const userId = await requireUserId();
  try {
    const client = createOpenAiTextClient();
    if (!client) return { ok: false, reason: "unavailable" };
    if (!usableInput(input)) return { ok: false, reason: "error" };

    const db = getDb();
    if (!(await consumeAiQuota(db, userId, "text"))) {
      return { ok: false, reason: "quota", remaining: 0 };
    }
    const remaining = (await getAiQuotaRemaining(db, userId)).text;

    const raw = await client.complete(
      buildPricePrompt(input, await requestLocale()),
    );
    const suggestion = toPriceSuggestion(raw);
    if (!suggestion) return { ok: false, reason: "error", remaining };

    return { ok: true, value: suggestion, remaining };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Starts the async image generation job for an owned wish (edit mode / retry
 * from a failed card). Consumes 1 `image`; the wish row's `imageStatus` is the
 * job state. Someone else's wish resolves as plain `error` exactly like a
 * missing one — no ownership oracle.
 *
 * ORDER — auth, then ownership, then quota, then the status flip, then the job.
 * The ownership check is a plain read done HERE, before `armImageGeneration`
 * touches the budget, so a stranger poking at wish ids never spends a unit of
 * somebody else's quota; the rest of the ordering is documented on the shared
 * arm path itself.
 */
export async function generateWishImageAction(
  wishId: string,
): Promise<AiResult<null>> {
  const userId = await requireUserId();
  try {
    const imageClient = createOpenAiImageClient();
    if (!imageClient) return { ok: false, reason: "unavailable" };

    const db = getDb();
    // Foreign and missing answer identically — no ownership oracle.
    const wish = await getOwnerWish(db, userId, wishId);
    if (!wish) return { ok: false, reason: "error" };

    const armed = await armImageGeneration({
      db,
      userId,
      wish,
      imageClient,
      storagePut: (data, name, contentType) =>
        storage.putBuffer(data, name, contentType),
      storageDelete: deleteStoredImage,
      schedule: scheduleImageJob,
    });
    if (armed === "quota") return { ok: false, reason: "quota", remaining: 0 };

    const remaining = (await getAiQuotaRemaining(db, userId)).image;
    if (armed === "not_found") return { ok: false, reason: "error", remaining };

    revalidatePath("/");
    revalidatePath(`/wishes/${wishId}`);
    return { ok: true, value: null, remaining };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Owner-only poll target for cards in `generating`: returns the current image
 * state, or null for a missing/foreign wish (same shape — no oracle).
 */
export async function getWishImageStateAction(
  wishId: string,
): Promise<{ imageStatus: WishImageStatus; imageUrl: string | null } | null> {
  const userId = await requireUserId();
  try {
    return await getImageState(getDb(), userId, wishId);
  } catch {
    // The poller reads null as "stop asking"; a transient read error must not
    // surface as a thrown action in the middle of a 3-second interval.
    return null;
  }
}
