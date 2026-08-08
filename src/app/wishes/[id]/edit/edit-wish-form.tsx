"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateWishAction } from "@/app/wishes/actions";
import {
  EVERYONE_AUDIENCE,
  type AudienceOptions,
  type WishAudienceValue,
} from "@/components/wishes/visibility-sheet";
import {
  WishForm,
  type WishFormResult,
  type WishFormValues,
} from "@/components/wishes/wish-form";
import type { OwnerWish } from "@/db/access/types";
import type { WishInput } from "@/db/access/mutations";
import type { AiQuotaSnapshot } from "@/lib/ai/types";

/** `imageKey` stores our CDN URL (not a bare storage key — see
 *  `db/access/mutations.ts`), so it maps straight onto the form's `imageUrl`. */
function toFormValues(
  wish: OwnerWish,
  audience: WishAudienceValue,
): WishFormValues {
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
    audience,
    // Generation is always re-armed per save (Phase 6 §6.2/§6.3) — an
    // existing wish never carries a stale "generate on save" intent forward.
    generateImage: false,
  };
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function sameAudience(a: WishAudienceValue, b: WishAudienceValue): boolean {
  return (
    a.mode === b.mode &&
    sameIds(a.groupIds, b.groupIds) &&
    sameIds(a.userIds, b.userIds)
  );
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

export function EditWishForm({
  wish,
  audience = EVERYONE_AUDIENCE,
  candidates,
  ai,
}: {
  wish: OwnerWish;
  /** The wish's stored audience, read server-side by the page. */
  audience?: WishAudienceValue;
  candidates: AudienceOptions;
  /** Server-computed AI availability + daily quota snapshot; undefined hides
   *  every AI affordance on the form (see `WishForm`'s `ai` prop). */
  ai?: AiQuotaSnapshot;
}) {
  const router = useRouter();
  const t = useTranslations("form");

  async function handleSubmit(values: WishFormValues): Promise<WishFormResult> {
    // An untouched audience is left out entirely, so saving a title never
    // re-validates subjects the owner may no longer be allowed to name (a
    // group they have since left, say) and never rewrites the rows.
    const changed = sameAudience(values.audience, audience)
      ? undefined
      : values.audience;
    const result = await updateWishAction(
      wish.id,
      toWishInput(values),
      changed,
      { generateImage: values.generateImage },
    );
    if (result.ok) {
      router.push(`/wishes/${wish.id}`);
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

  return (
    <WishForm
      heading={t("editTitle")}
      initial={toFormValues(wish, audience)}
      candidates={candidates}
      ai={ai}
      submitLabel={t("save")}
      onSubmit={handleSubmit}
      backHref={`/wishes/${wish.id}`}
    />
  );
}
