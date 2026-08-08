"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createWishAction } from "@/app/wishes/actions";
import type { WishDraft } from "@/app/wishes/ai-actions";
import type { ParseFields } from "@/app/wishes/parse-actions";
import type { AudienceOptions } from "@/components/wishes/visibility-sheet";
import {
  WishForm,
  type WishFormPriceType,
  type WishFormResult,
  type WishFormValues,
} from "@/components/wishes/wish-form";
import type { AiQuotaSnapshot } from "@/lib/ai/types";
import type { WishInput } from "@/db/access/mutations";

const PARSED_STORAGE_KEY = "wishka-parsed-wish";
const AI_DRAFT_STORAGE_KEY = "wishka-ai-draft";

type ParsedHandoff = {
  fields: ParseFields;
  url: string;
  partial: boolean;
};

type AiDraftHandoff = { draft: WishDraft };

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

/** Reads and clears the sessionStorage handoff the add-wish sheet leaves
 *  behind on a drafted-from-words wish (`?ai=1`) — one-shot, same contract as
 *  `readParsedHandoff`. */
function readAiDraftHandoff(): AiDraftHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(AI_DRAFT_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<AiDraftHandoff> | null;
    if (!parsed || typeof parsed !== "object" || !parsed.draft) return null;
    return { draft: parsed.draft };
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

/** Same resolution rule as `priceTypeFor`, over `WishDraft`'s shape instead
 *  of `ParseFields` — its price fields are optional rather than nullable, so
 *  it needs its own presence check. */
function priceTypeForDraft(draft: WishDraft): WishFormPriceType {
  if (draft.priceMin && draft.priceMax) return "range";
  if (draft.priceMin) return "exact";
  return "none";
}

function aiDraftToInitial(
  draft: WishDraft,
  baseCurrency: string,
): Partial<WishFormValues> {
  const priceType = priceTypeForDraft(draft);
  return {
    title: draft.title ?? "",
    type: draft.type ?? "product",
    category: draft.category ?? null,
    description: draft.description ?? null,
    priceType,
    priceMin: priceType === "none" ? null : (draft.priceMin ?? null),
    priceMax: priceType === "range" ? (draft.priceMax ?? null) : null,
    currency: draft.currency ?? baseCurrency,
  };
}

type Resolved = {
  initial: Partial<WishFormValues>;
  parsedUrl: boolean;
  parsedPartial: boolean;
  aiDraft: boolean;
};

/** The SSR-safe branches — no browser APIs, so server and client agree. */
function resolveStatic(
  url: string | undefined,
  baseCurrency: string,
): Resolved {
  if (url) {
    return {
      initial: { url },
      parsedUrl: false,
      parsedPartial: false,
      aiDraft: false,
    };
  }
  return {
    initial: { currency: baseCurrency },
    parsedUrl: false,
    parsedPartial: false,
    aiDraft: false,
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
  candidates,
  url,
  parsed,
  aiHandoff,
  ai,
}: {
  baseCurrency: string;
  /** Scopes the draft's localStorage key so two accounts on one device/
   *  browser never share a single "wishka-wish-draft" slot. */
  userId: string;
  /** Groups and people this owner may address a restricted wish to, fetched
   *  server-side by the page. */
  candidates: AudienceOptions;
  /** Plain "?url=" handoff — the manual form after a failed/stoplist/quota
   *  parse, with the typed link preserved. */
  url?: string;
  /** "?parsed=1" — a successful/partial parse left fields in sessionStorage. */
  parsed?: boolean;
  /** "?ai=1" — a "Добавь словами" draft left fields in sessionStorage. */
  aiHandoff?: boolean;
  /** Server-computed AI availability + daily quota snapshot; undefined hides
   *  every AI affordance on the form (see `WishForm`'s `ai` prop). */
  ai?: AiQuotaSnapshot;
}) {
  const router = useRouter();
  const t = useTranslations("form");

  // The `?parsed=1`/`?ai=1` handoffs live in sessionStorage — a browser-only
  // source. Reading them during render would make the first client render
  // diverge from the server's (which has no sessionStorage), causing a
  // hydration mismatch. So: a pending handoff starts unresolved (null) and is
  // filled in a mount effect; the SSR-safe url/default branches resolve
  // synchronously and render right away.
  const [resolved, setResolved] = useState<Resolved | null>(() =>
    parsed || aiHandoff ? null : resolveStatic(url, baseCurrency),
  );

  // read*Handoff() consumes the storage entry, so it must run exactly once —
  // without this guard React 19 StrictMode's double-invoked mount effect
  // would read it on pass 1 and get null on pass 2, blanking the form.
  const didResolve = useRef(false);

  useEffect(() => {
    if ((!parsed && !aiHandoff) || didResolve.current) return;
    didResolve.current = true;
    // Named function, invoked once — keeps the setState out of the effect's
    // synchronous top level (react-hooks/set-state-in-effect).
    const resolveHandoff = () => {
      // A resolved handoff (of either kind) wins over any stored draft —
      // clear it so WishForm's mount-time draft offer finds nothing and never
      // shows the "resume draft?" banner this once. Autosave then re-saves as
      // the user edits.
      const clearStoredDraft = () => {
        try {
          window.localStorage.removeItem(`wishka-wish-draft:${userId}`);
        } catch {
          // Best-effort — an unclearable draft only means the banner may show.
        }
      };

      if (aiHandoff) {
        const draftHandoff = readAiDraftHandoff(); // one-shot: consumes the entry
        if (!draftHandoff) {
          setResolved(resolveStatic(url, baseCurrency));
          return;
        }
        clearStoredDraft();
        setResolved({
          initial: aiDraftToInitial(draftHandoff.draft, baseCurrency),
          parsedUrl: false,
          parsedPartial: false,
          aiDraft: true,
        });
        return;
      }

      const handoff = readParsedHandoff(); // one-shot: consumes the storage entry
      if (!handoff) {
        setResolved(resolveStatic(url, baseCurrency));
        return;
      }
      clearStoredDraft();
      setResolved({
        initial: handoffToInitial(handoff, baseCurrency),
        parsedUrl: true,
        parsedPartial: handoff.partial,
        aiDraft: false,
      });
    };
    resolveHandoff();
  }, [parsed, aiHandoff, url, baseCurrency, userId]);

  async function handleSubmit(values: WishFormValues): Promise<WishFormResult> {
    const result = await createWishAction(
      toWishInput(values),
      values.audience,
      { generateImage: values.generateImage },
    );
    if (result.ok) {
      router.push("/");
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

  // Only reached for `?parsed=1`/`?ai=1`, and only for the one frame before
  // the mount effect resolves the handoff (that route is always entered via
  // client navigation, so this is momentary).
  if (!resolved) {
    return <div className="min-h-dvh" aria-busy="true" />;
  }

  return (
    <WishForm
      heading={t("newTitle")}
      enableDraft
      draftScope={userId}
      candidates={candidates}
      baseCurrency={baseCurrency}
      initial={resolved.initial}
      parsedUrl={resolved.parsedUrl}
      parsedPartial={resolved.parsedPartial}
      aiDraft={resolved.aiDraft}
      ai={ai}
      submitLabel={t("submit")}
      onSubmit={handleSubmit}
    />
  );
}
