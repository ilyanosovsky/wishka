"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateWishAction } from "@/app/wishes/actions";
import {
  WishForm,
  type WishFormResult,
  type WishFormValues,
} from "@/components/wishes/wish-form";
import type { OwnerWish } from "@/db/access/types";
import type { WishInput } from "@/db/access/mutations";

/** `imageKey` stores our CDN URL (not a bare storage key — see
 *  `db/access/mutations.ts`), so it maps straight onto the form's `imageUrl`. */
function toFormValues(wish: OwnerWish): WishFormValues {
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

function toWishInput(values: WishFormValues): WishInput {
  return {
    type: values.type,
    title: values.title,
    url: values.url,
    imageUrl: values.imageUrl,
    description: values.description ?? null,
    priceType: values.priceType,
    priceMin: values.priceMin,
    priceMax: values.priceMax,
    currency: values.currency,
    priority: values.priority,
    isDream: values.isDream,
    category: values.category,
    notes: values.notes,
  };
}

export function EditWishForm({ wish }: { wish: OwnerWish }) {
  const router = useRouter();
  const t = useTranslations("form");

  async function handleSubmit(values: WishFormValues): Promise<WishFormResult> {
    const result = await updateWishAction(wish.id, toWishInput(values));
    if (result.ok) {
      router.push(`/wishes/${wish.id}`);
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

  return (
    <WishForm
      initial={toFormValues(wish)}
      submitLabel={t("save")}
      onSubmit={handleSubmit}
      backHref={`/wishes/${wish.id}`}
    />
  );
}
