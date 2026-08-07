"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createWishAction } from "@/app/wishes/actions";
import {
  WishForm,
  type WishFormResult,
  type WishFormValues,
} from "@/components/wishes/wish-form";
import type { WishInput } from "@/db/access/mutations";

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

/** Client wrapper: owns the redirect on success so `WishForm` itself stays
 *  free of navigation concerns beyond its own "back" control. */
export function NewWishForm({
  baseCurrency,
  userId,
}: {
  baseCurrency: string;
  /** Scopes the draft's localStorage key so two accounts on one device/
   *  browser never share a single "wishka-wish-draft" slot. */
  userId: string;
}) {
  const router = useRouter();
  const t = useTranslations("form");

  async function handleSubmit(values: WishFormValues): Promise<WishFormResult> {
    const result = await createWishAction(toWishInput(values));
    if (result.ok) {
      router.push("/");
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

  return (
    <WishForm
      enableDraft
      draftScope={userId}
      initial={{ currency: baseCurrency }}
      submitLabel={t("submit")}
      onSubmit={handleSubmit}
    />
  );
}
