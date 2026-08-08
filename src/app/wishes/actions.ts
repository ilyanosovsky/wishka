"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db";
import {
  restoreWish,
  type WishInput,
  type WishValidationError,
} from "@/db/access/mutations";
import type { OwnerWish } from "@/db/access/types";
import {
  createWishWithAudience,
  type AudienceError,
  type WishAudience,
} from "@/db/access/visibility";
import {
  deleteWishAsOwner,
  getReservationNotificationTargetById,
  markGiftedAsOwner,
  updateWishAsOwner,
} from "@/db/access/wish-lifecycle";
import { createOpenAiImageClient } from "@/lib/ai/client";
import {
  armImageGeneration,
  runImageGenerationJob,
  type ScheduledImageJob,
} from "@/lib/ai/image-job";
import { getAuth } from "@/lib/auth";
import type { ReservationChangedField } from "@/lib/email/copy";
import {
  sendGiftGiven,
  sendReservedWishChanged,
  sendReservedWishDeleted,
  sendReservedWishHidden,
} from "@/lib/email/reservation-emails";
import { storage } from "@/lib/storage";
import { extractStorageKey } from "@/lib/storage/uploadthing";

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user.id;
}

/**
 * SURPRISE INVARIANT — every owner mutation captures the booking to notify
 * *atomically inside its own transaction* (`updateWishAsOwner` &co.), then
 * dispatches the email from that opaque id inside `after()` (post-response).
 * The captured id never reaches a return value, and the owner-visible result of
 * each action is exactly what it was before reservations existed.
 */

function wishAppUrl(wishId: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/w/${wishId}`;
}

/** The fields a reserver is told about (§6.7): title, link, price. */
function materialChanges(
  before: OwnerWish,
  updated: OwnerWish,
): ReservationChangedField[] {
  const changed: ReservationChangedField[] = [];
  if (before.title !== updated.title) changed.push("title");
  if ((before.url ?? null) !== (updated.url ?? null)) changed.push("url");
  if (
    before.priceType !== updated.priceType ||
    before.priceMin !== updated.priceMin ||
    before.priceMax !== updated.priceMax ||
    before.currency !== updated.currency
  ) {
    changed.push("price");
  }
  return changed;
}

export type WishActionResult =
  | { ok: true; wish: OwnerWish }
  | { ok: false; error: WishValidationError | AudienceError | "not_found" };

const EVERYONE: WishAudience = { mode: "everyone", groupIds: [], userIds: [] };

/** What a save can ask for beyond the wish itself. */
export type WishActionOptions = {
  /** The form armed the AI image toggle (`ai.generateImage`): start the job
   *  after saving. */
  generateImage?: boolean;
};

/**
 * Hands the job to Vercel's `after()`. This is the repo's first post-response
 * task that writes to the database, so it opens a FRESH handle — the request's
 * is done by then — and lets nothing escape: an unhandled rejection in
 * `after()` takes down the whole post-response phase.
 *
 * Deliberately not exported and deliberately duplicated in `ai-actions.ts`: a
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
 * Drops a generated file whose wish never ended up pointing at it. The job
 * hands back the URL `storage.putBuffer` returned, so the key is always ours;
 * a URL we cannot read a key out of is left alone rather than guessed at.
 *
 * Duplicated in `ai-actions.ts` for the same reason as the scheduler below.
 */
async function deleteStoredImage(url: string): Promise<void> {
  const key = extractStorageKey(url);
  if (key) await storage.delete(key);
}

/**
 * Arms the AI picture job for a wish that has *already* been saved.
 *
 * INVARIANT #3 — nothing in here can fail the save. No API key, an exhausted
 * daily budget, a row that vanished under us, a model client that throws while
 * being built: all of them are a silent skip, and the wish simply keeps the
 * image it has. The advisory counter in the form is the only warning the user
 * gets, and it is allowed to be stale.
 *
 * Returns whether the wish is now in `generating`, so the caller can hand the
 * form back a DTO that matches the row instead of one claiming "no picture".
 */
async function armSavedWish(userId: string, wish: OwnerWish): Promise<boolean> {
  try {
    const imageClient = createOpenAiImageClient();
    if (!imageClient) return false;

    const armed = await armImageGeneration({
      db: getDb(),
      userId,
      wish,
      imageClient,
      storagePut: (data, name, contentType) =>
        storage.putBuffer(data, name, contentType),
      storageDelete: deleteStoredImage,
      schedule: scheduleImageJob,
    });
    return armed === "armed";
  } catch {
    return false;
  }
}

export async function createWishAction(
  input: WishInput,
  audience?: WishAudience,
  opts?: WishActionOptions,
): Promise<WishActionResult> {
  const userId = await requireUserId();
  const result = await createWishWithAudience(
    getDb(),
    userId,
    input,
    audience ?? EVERYONE,
  );
  if (!result.ok) return result;

  const generating =
    opts?.generateImage === true && (await armSavedWish(userId, result.wish));
  revalidatePath("/");
  return generating
    ? { ok: true, wish: { ...result.wish, imageStatus: "generating" } }
    : result;
}

/** `audience` omitted means "leave the wish's audience alone" — an edit that
 *  only touches the card must not rewrite `wish_visibility`. */
export async function updateWishAction(
  wishId: string,
  input: Partial<WishInput>,
  audience?: WishAudience,
  opts?: WishActionOptions,
): Promise<WishActionResult> {
  const userId = await requireUserId();
  const { result, before, notifyReservationId, reserverLostAccess } =
    await updateWishAsOwner(getDb(), userId, wishId, input, audience);
  if (result.ok) {
    const changed = before ? materialChanges(before, result.wish) : [];
    // Losing access supersedes "the wish changed": one email, and it is the
    // one that explains why the wish disappeared. Both branches live inside
    // `after()`, so nothing here is observable to the owner.
    if (notifyReservationId && (reserverLostAccess || changed.length > 0)) {
      after(async () => {
        const target = await getReservationNotificationTargetById(
          getDb(),
          notifyReservationId,
        );
        if (target?.email) {
          if (reserverLostAccess) {
            await sendReservedWishHidden({
              to: target.email,
              locale: target.locale,
              wishTitle: target.wishTitle,
            });
          } else {
            await sendReservedWishChanged({
              to: target.email,
              locale: target.locale,
              wishTitle: target.wishTitle,
              changedFields: changed,
              wishAppUrl: wishAppUrl(wishId),
            });
          }
        }
      });
    }
    const generating =
      opts?.generateImage === true && (await armSavedWish(userId, result.wish));
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
    if (generating) {
      return { ok: true, wish: { ...result.wish, imageStatus: "generating" } };
    }
  }
  return result;
}

/** Called after the 5s undo window expires — the UI removal is optimistic. */
export async function deleteWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const { result: ok, notifyReservationId } = await deleteWishAsOwner(
    getDb(),
    userId,
    wishId,
  );
  if (ok) {
    if (notifyReservationId) {
      after(async () => {
        const target = await getReservationNotificationTargetById(
          getDb(),
          notifyReservationId,
        );
        if (target?.email) {
          await sendReservedWishDeleted({
            to: target.email,
            locale: target.locale,
            wishTitle: target.wishTitle,
          });
        }
      });
    }
    revalidatePath("/");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok };
}

export async function markGiftedAction(
  wishId: string,
  giftedBy: string | null,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  // giftedBy is FREE TEXT by invariant #1 — never derived from reservations.
  const { result: wish, notifyReservationId } = await markGiftedAsOwner(
    getDb(),
    userId,
    wishId,
    giftedBy?.trim() || null,
  );
  if (wish) {
    // "Your gift is marked as delivered" — reaches the booking that was active
    // when the wish was gifted, pinned atomically inside the mutation.
    if (notifyReservationId) {
      after(async () => {
        const target = await getReservationNotificationTargetById(
          getDb(),
          notifyReservationId,
        );
        if (target?.email) {
          await sendGiftGiven({
            to: target.email,
            locale: target.locale,
            wishTitle: target.wishTitle,
          });
        }
      });
    }
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok: wish !== null };
}

export async function restoreWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const wish = await restoreWish(getDb(), userId, wishId);
  if (wish) {
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok: wish !== null };
}

/**
 * Permanent delete from the archive (confirmed by dialog). Orphans like any
 * delete, but sends no email: an archived wish was already resolved for the
 * reserver (given, or long settled) — "the owner deleted it" would only
 * confuse.
 */
export async function destroyWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const { result: ok } = await deleteWishAsOwner(getDb(), userId, wishId);
  if (ok) {
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok };
}
