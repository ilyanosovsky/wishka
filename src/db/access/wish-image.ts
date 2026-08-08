import { and, eq } from "drizzle-orm";

import { extractStorageKey } from "@/lib/storage/uploadthing";
import type { Db } from "../index";
import { wishes } from "../schema";
import { isUuid } from "./ids";
import type { WishImageStatus } from "./types";

/**
 * The state machine of an AI-generated wish picture. The `wishes` row *is* the
 * job state — there is no queue table — so exactly three narrow mutations move
 * `image_status` between `generating`, `ready` and `failed`.
 *
 * They live apart from `mutations.ts` on purpose: `validate()` there maps a
 * form submission to `none | ready` only, and teaching it the async statuses
 * would let a plain edit resurrect or cancel a running job.
 *
 * SURPRISE INVARIANT — one table, two columns, no join. Nothing here can learn
 * about bookings.
 *
 * OWNERSHIP — the two owner-facing entry points carry `owner_id = ownerId` in
 * their WHERE, so someone else's wish id is indistinguishable from a missing
 * one (`not_found` / `null`). `finishImageGeneration` is the job's own callback
 * and is keyed by wish id alone — it runs after the request that authorised it
 * has already returned, and it can only ever land on a row this app itself put
 * into `generating`.
 */

/** Arms a wish for generation. Any current status may be replaced: this is
 *  both "generate for a fresh wish" and "retry a failed (or stuck) one". */
export async function startImageGeneration(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<"started" | "not_found"> {
  if (!isUuid(wishId)) return "not_found";

  const [row] = await db
    .update(wishes)
    .set({ imageStatus: "generating", updatedAt: new Date() })
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .returning({ id: wishes.id });
  return row ? "started" : "not_found";
}

/**
 * The job's terminal write: a URL means `ready`, `null` means `failed` — and
 * `failed` even when the wish already had a picture, because §6.2 shows the
 * failure state with "retry / upload a photo" rather than silently keeping the
 * old image and pretending nothing happened.
 *
 * CLOBBER GUARD — only rows still in `generating` are touched. The owner may
 * have uploaded a real photo (or deleted the wish) while the model was drawing;
 * that write is the newer intent and must win over a job that started earlier.
 * Returns whether a row was actually updated, so a superseded job is visible in
 * tests rather than silent.
 */
export async function finishImageGeneration(
  db: Db,
  wishId: string,
  imageUrl: string | null,
): Promise<boolean> {
  if (!isUuid(wishId)) return false;

  // INVARIANT #6 — `image_key` may only ever hold a URL on our own storage.
  // The job builds this URL from `storage.putBuffer`, so a foreign one means
  // the adapter changed under us: fail the wish rather than store a hotlink.
  const stored = imageUrl !== null && extractStorageKey(imageUrl) !== null;

  const [row] = await db
    .update(wishes)
    .set(
      stored
        ? { imageKey: imageUrl, imageStatus: "ready", updatedAt: new Date() }
        : { imageStatus: "failed", updatedAt: new Date() },
    )
    .where(and(eq(wishes.id, wishId), eq(wishes.imageStatus, "generating")))
    .returning({ id: wishes.id });
  return row !== undefined;
}

/** What the owner's card polls while a job runs. Null for a missing or foreign
 *  wish — same answer for both, so ids are not an enumeration oracle. */
export async function getImageState(
  db: Db,
  ownerId: string,
  wishId: string,
): Promise<{ imageStatus: WishImageStatus; imageUrl: string | null } | null> {
  if (!isUuid(wishId)) return null;

  const [row] = await db
    .select({ imageStatus: wishes.imageStatus, imageUrl: wishes.imageKey })
    .from(wishes)
    .where(and(eq(wishes.ownerId, ownerId), eq(wishes.id, wishId)))
    .limit(1);
  return row ?? null;
}
