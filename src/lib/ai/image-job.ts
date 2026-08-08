import type { Db } from "@/db";
import type { OwnerWish } from "@/db/access/types";
import {
  finishImageGeneration,
  startImageGeneration,
} from "@/db/access/wish-image";
import type { AiImageClient } from "./client";
import { buildImagePrompt, wishToSuggestionInput } from "./prompts";
import { consumeAiQuota } from "./quota";

/**
 * The background half of image generation: draw, store, write the terminal
 * status. It runs inside Vercel's `after()`, so nobody is waiting for it and
 * nobody can be shown an error from it — the only way it communicates is the
 * `image_status` of the wish, which the card polls.
 *
 * Two rules make it safe to fire and forget:
 *   1. it never throws — an escaping error inside `after()` is unhandled and
 *      would leave the card spinning on `generating` forever;
 *   2. every path, including the failures, lands on exactly one
 *      `finishImageGeneration` call, so the row always reaches a terminal
 *      status (or is left alone by the clobber guard, which is the owner
 *      having overtaken the job with their own photo).
 *
 * Dependencies are injected so the whole job is testable against PGlite with a
 * fake model and a fake bucket.
 */

/** Same cap as `parse/rehost.ts`: a decoded base64 payload is memory we already
 *  hold, and an absurd one must not be pushed into storage. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageGenerationJob = {
  db: Db;
  wishId: string;
  prompt: string;
  imageClient: AiImageClient;
  /** Wired to `storage.putBuffer` — invariant #6, never a foreign URL. */
  storagePut: (
    data: Uint8Array,
    name: string,
    contentType: string,
  ) => Promise<{ url: string }>;
};

export async function runImageGenerationJob(
  job: ImageGenerationJob,
): Promise<void> {
  const { db, wishId, prompt, imageClient, storagePut } = job;

  let imageUrl: string | null = null;
  try {
    const bytes = await imageClient.generate(prompt);
    if (bytes && bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_BYTES) {
      const stored = await storagePut(
        bytes,
        `wish-ai-${wishId}.png`,
        "image/png",
      );
      imageUrl = stored?.url ?? null;
    }
  } catch {
    // A rejected upload, an oversized payload, anything at all: the wish just
    // ends up in `failed`, where the card offers retry and "upload a photo".
    imageUrl = null;
  }

  try {
    await finishImageGeneration(db, wishId, imageUrl);
  } catch {
    // The database is unreachable at the very end of a post-response job.
    // There is nothing left to fall back to; swallow so `after()` stays clean.
    // The card's poller gives up after ~3 minutes and shows the stored status.
  }
}

/** Everything the job needs except the handle — the scheduler opens a fresh
 *  one inside `after()`, because the request's is finished by then. */
export type ScheduledImageJob = Omit<ImageGenerationJob, "db">;

export type ArmImageGenerationDeps = {
  db: Db;
  userId: string;
  /** An owned wish the CALLER has already resolved. The ownership check must
   *  happen before this point, so a stranger poking at wish ids never spends a
   *  unit of somebody else's budget. */
  wish: OwnerWish;
  imageClient: AiImageClient;
  storagePut: ImageGenerationJob["storagePut"];
  /** Wired to Next's `after()`; called at most once, only after the wish row
   *  really moved into `generating`. */
  schedule: (job: ScheduledImageJob) => void;
};

export type ArmImageResult = "armed" | "quota" | "not_found";

/**
 * The one start path for image generation, shared by "save with a generated
 * picture" and "retry from a failed card".
 *
 * ORDER — quota first, then the status flip, then the job:
 *   - a refused quota leaves the wish exactly as it was, rather than parked in
 *     `generating` with no job coming for it;
 *   - the job is scheduled only once the flip reported `started`, so it is
 *     scheduled exactly once and always against a row that is really armed.
 * A wish deleted between the caller's ownership read and the flip costs one
 * unit of quota for nothing — a race with the user's own delete, and the
 * cheapest of the orderings to be wrong about.
 */
export async function armImageGeneration(
  deps: ArmImageGenerationDeps,
): Promise<ArmImageResult> {
  const { db, userId, wish, imageClient, storagePut, schedule } = deps;

  if (!(await consumeAiQuota(db, userId, "image"))) return "quota";
  if ((await startImageGeneration(db, userId, wish.id)) === "not_found") {
    return "not_found";
  }

  schedule({
    wishId: wish.id,
    prompt: buildImagePrompt(wishToSuggestionInput(wish)),
    imageClient,
    storagePut,
  });
  return "armed";
}
