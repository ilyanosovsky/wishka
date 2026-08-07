"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import {
  createWish,
  deleteWish,
  markGifted,
  restoreWish,
  updateWish,
  type WishInput,
  type WishValidationError,
} from "@/db/access/mutations";
import type { OwnerWish } from "@/db/access/types";
import { getAuth } from "@/lib/auth";

async function requireUserId(): Promise<string> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user.id;
}

export type WishActionResult =
  | { ok: true; wish: OwnerWish }
  | { ok: false; error: WishValidationError | "not_found" };

export async function createWishAction(
  input: WishInput,
): Promise<WishActionResult> {
  const userId = await requireUserId();
  const result = await createWish(getDb(), userId, input);
  if (result.ok) revalidatePath("/");
  return result;
}

export async function updateWishAction(
  wishId: string,
  input: Partial<WishInput>,
): Promise<WishActionResult> {
  const userId = await requireUserId();
  const result = await updateWish(getDb(), userId, wishId, input);
  if (result.ok) {
    revalidatePath("/");
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return result;
}

/** Called after the 5s undo window expires — the UI removal is optimistic. */
export async function deleteWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const ok = await deleteWish(getDb(), userId, wishId);
  if (ok) {
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
  const wish = await markGifted(
    getDb(),
    userId,
    wishId,
    giftedBy?.trim() || null,
  );
  if (wish) {
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

/** Permanent delete from the archive (confirmed by dialog). */
export async function destroyWishAction(
  wishId: string,
): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const ok = await deleteWish(getDb(), userId, wishId);
  if (ok) {
    revalidatePath("/archive");
    revalidatePath(`/wishes/${wishId}`);
  }
  return { ok };
}
