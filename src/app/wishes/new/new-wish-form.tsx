"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createWishAction } from "@/app/wishes/actions";
import type { ParseFields } from "@/app/wishes/parse-actions";
import {
  WishForm,
  type WishFormPriceType,
  type WishFormResult,
  type WishFormValues,
} from "@/components/wishes/wish-form";
import type { WishInput } from "@/db/access/mutations";

const PARSED_STORAGE_KEY = "wishka-parsed-wish";

type ParsedHandoff = {
  fields: ParseFields;
  url: string;
  partial: boolean;
};

/** Reads and clears the sessionStorage handoff the add-wish sheet leaves
 *  behind on a successful parse (`?parsed=1`) — one-shot by design, so a
 *  refresh or a second visit to the same URL never resurfaces it. */
function readParsedHandoff(): ParsedHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PARSED_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PARSED_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<ParsedHandoff> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.fields) return null;
    return {
      fields: parsed.fields,
      url: typeof parsed.url === "string" ? parsed.url : "",
      partial: Boolean(parsed.partial),
    };
  } catch {
    return null;
  }
}

function priceTypeFor(fields: ParseFields): WishFormPriceType {
  if (fields.priceMin && fields.priceMax) return "range";
  if (fields.priceMin) return "exact";
  return "none";
}

function handoffToInitial(
  handoff: ParsedHandoff,
  baseCurrency: string,
): Partial<WishFormValues> {
  const { fields, url } = handoff;
  const priceType = priceTypeFor(fields);
  // Keep price fields consistent with the resolved type: a lone priceMax
  // (no priceMin) resolves to "none", so it must not leak into the form.
  return {
    title: fields.title ?? "",
    description: fields.description,
    imageUrl: fields.imageUrl,
    priceType,
    priceMin: priceType === "none" ? null : fields.priceMin,
    priceMax: priceType === "range" ? fields.priceMax : null,
    currency: fields.currency ?? baseCurrency,
    url,
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

/** Client wrapper: owns the redirect on success so `WishForm` itself stays
 *  free of navigation concerns beyond its own "back" control. */
export function NewWishForm({
  baseCurrency,
  userId,
  url,
  parsed,
}: {
  baseCurrency: string;
  /** Scopes the draft's localStorage key so two accounts on one device/
   *  browser never share a single "wishka-wish-draft" slot. */
  userId: string;
  /** Plain "?url=" handoff — the manual form after a failed/stoplist/quota
   *  parse, with the typed link preserved. */
  url?: string;
  /** "?parsed=1" — a successful/partial parse left fields in sessionStorage. */
  parsed?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("form");

  // Resolved once: reading (and clearing) sessionStorage must happen exactly
  // one time regardless of re-renders, so this runs lazily inside useState's
  // initializer rather than an effect, which could race the very first paint.
  const [{ initial, parsedUrl, parsedPartial }] = useState(() => {
    if (parsed) {
      const handoff = readParsedHandoff();
      if (handoff) {
        // A parsed handoff wins over any stored draft — clear it up front so
        // WishForm's own mount-time draft offer finds nothing and never
        // shows the "resume draft?" banner this one time. Autosave (still
        // enabled below) then re-saves over this slot as the user edits.
        try {
          window.localStorage.removeItem(`wishka-wish-draft:${userId}`);
        } catch {
          // Best-effort only — an unclearable draft just means the resume
          // banner might show once; not worth failing the handoff over.
        }
        return {
          initial: handoffToInitial(handoff, baseCurrency),
          parsedUrl: true,
          parsedPartial: handoff.partial,
        };
      }
    }
    if (url) {
      return {
        initial: { url } as Partial<WishFormValues>,
        parsedUrl: false,
        parsedPartial: false,
      };
    }
    return {
      initial: { currency: baseCurrency } as Partial<WishFormValues>,
      parsedUrl: false,
      parsedPartial: false,
    };
  });

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
      initial={initial}
      parsedUrl={parsedUrl}
      parsedPartial={parsedPartial}
      submitLabel={t("submit")}
      onSubmit={handleSubmit}
    />
  );
}
