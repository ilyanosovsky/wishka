"use client";

import { ChevronDown, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  suggestDescriptionAction,
  suggestPriceAction,
  type SuggestionInput,
} from "@/app/wishes/ai-actions";
import { DreamStamp, PriorityFlag } from "@/components/ui/badges";
import { AlertBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextareaField, TextField } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import type { AiQuotaSnapshot } from "@/lib/ai/types";
import { CATEGORY_KEYS } from "@/lib/categories";
import { CURRENCIES, type CurrencyCode } from "@/lib/currencies";
import { useUploadThing } from "@/lib/uploadthing-client";
import { downscaleForWish } from "@/lib/wish-image";
import { CurrencySheet } from "./currency-sheet";
import {
  addressableAudience,
  audienceSubjectCount,
  EMPTY_AUDIENCE_OPTIONS,
  EVERYONE_AUDIENCE,
  VisibilitySheet,
  type AudienceOptions,
  type WishAudienceValue,
} from "./visibility-sheet";

/**
 * §6.3 step-3 form — the one card form used by both "new" and "edit". No
 * server imports: `WishFormValues` mirrors `WishInput` (see
 * `src/db/access/mutations.ts`) in shape only, so this file stays usable
 * without pulling in the DB layer.
 */

export type WishFormType = "product" | "experience" | "service" | "certificate";
export type WishFormPriceType = "none" | "exact" | "range";
export type WishFormPriority = "want" | "nice" | "idea";

export type WishFormValues = {
  type: WishFormType;
  title: string;
  url: string | null;
  imageUrl: string | null;
  description?: string | null;
  priceType: WishFormPriceType;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  priority: WishFormPriority;
  isDream: boolean;
  category: string | null;
  notes: string | null;
  /** Who the wish is for (§6.3). Proposed here, validated server-side. */
  audience: WishAudienceValue;
  /** Armed in the form, started on save (Phase 6 §6.2/§6.3): true means the
   *  wrapper should pass `opts: { generateImage: true }` to the create/update
   *  action. Never sent through `toWishInput` — it isn't a wish column. */
  generateImage: boolean;
};

export type WishFormResult = { ok: true } | { ok: false; error: string };

/** Local UI state for a suggestion affordance — `AiFailReason` plus `busy`,
 *  the one client-only state the server result never carries. */
type SuggestState = "idle" | "busy" | "failed" | "quota" | "unavailable";

export interface WishFormProps {
  initial?: Partial<WishFormValues>;
  submitLabel: string;
  onSubmit: (values: WishFormValues) => Promise<WishFormResult>;
  /** Draft persistence + "unsaved changes" dialog — the new-wish page only. */
  enableDraft?: boolean;
  /** Scopes the draft's localStorage key to a user — pass the signed-in
   *  user's id. Without it, drafts from different accounts on the same
   *  device/browser would collide in a single "wishka-wish-draft" slot. */
  draftScope?: string;
  /** Where the top-left back control (and the draft dialog's actions) send
   *  the user. Defaults to the list; the edit form points back at the wish. */
  backHref?: string;
  /** Page heading rendered next to the back control ("Новое желание" /
   *  "Редактировать") — without it the top row is a lone unlabeled button. */
  heading?: string;
  /** True when the Link field's initial value came from the URL parser
   *  (§6.3 step 3, "спарсено") — renders it as a read-only parsed-link row
   *  with a small edit affordance instead of the usual editable input. */
  parsedUrl?: boolean;
  /** True when the parser only partially filled the card (§6.3 step 2,
   *  "Частично") — shows a partial-notice banner and highlights an empty
   *  title immediately, without waiting for a blocked submit attempt. */
  parsedPartial?: boolean;
  /** Who the owner may address a restricted wish to — the owner's groups and
   *  their members, fetched by the page (server-side), never by the client. */
  candidates?: AudienceOptions;
  /** Server-computed AI availability + daily quota snapshot. Undefined means
   *  AI is unavailable (no key, or the page didn't check) — every AI
   *  affordance (suggestions, generate-image) is hidden, never just disabled. */
  ai?: AiQuotaSnapshot;
  /** True when `initial` came from the "Добавь словами" free-text draft
   *  (§6.3 AI addendum) — shows the `ai.fromAi` meta note, mirroring how
   *  `parsedUrl` shows `parse.fromParser` on the link field. */
  aiDraft?: boolean;
  /** The signed-in user's base currency, read from their profile by the page
   *  (§6.3 «сверху базовая и недавние»). It anchors the currency sheet and is
   *  what an empty price falls back to when the mode switches away from "нет
   *  цены". Absent only where no caller can supply it — see
   *  `FALLBACK_BASE_CURRENCY`. */
  baseCurrency?: string;
}

const DEFAULT_VALUES: WishFormValues = {
  type: "product",
  title: "",
  url: null,
  imageUrl: null,
  description: null,
  priceType: "none",
  priceMin: null,
  priceMax: null,
  currency: null,
  priority: "nice",
  isDream: false,
  category: null,
  notes: null,
  audience: EVERYONE_AUDIENCE,
  generateImage: false,
};

/**
 * Only for a caller that has no profile to read from (tests, a future embed).
 * Both real callers now pass `baseCurrency` from the owner's profile, so the
 * currency sheet anchors on the user's own base currency (§6.3), not on USD.
 */
const FALLBACK_BASE_CURRENCY: CurrencyCode = "USD";

/** The photo picker refuses obvious non-starters before the canvas and the
 *  upload, so §6.3's "слишком большой"/"не картинка" states are reachable
 *  rather than collapsing into one generic failure. `MAX_UPLOAD_BYTES` mirrors
 *  the `wishImage` route's own cap (`src/app/api/uploadthing/core.ts`) and is
 *  checked against the *downscaled* file — the one actually uploaded; the raw
 *  pick gets a much looser bound, since downscaling is exactly what turns a
 *  12 MP camera shot into something sendable. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PICK_BYTES = 32 * 1024 * 1024;

/** Which of §6.3's photo failures to show. `generic` covers everything the
 *  browser only reports after the fact (network, quota, a corrupt file). */
type PhotoError = "generic" | "tooLarge" | "notImage";

const LABEL_CLASS =
  "text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute";
const PRIORITIES: readonly WishFormPriority[] = ["want", "nice", "idea"];

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function symbolFor(code: string | null): string {
  if (!code) return "";
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

/** `normalizeAmount` (shared with the URL parser and the AI draft/price
 *  prompts) always answers a fixed-2 string like "1200.00" — strip a
 *  trailing ".00" so a suggestion with no meaningful cents reads "1200"
 *  rather than "1200.00", both on display and in the value actually
 *  accepted into the price fields. */
function trimTrailingZeroCents(value: string): string {
  return value.endsWith(".00") ? value.slice(0, -3) : value;
}

/** "1200–1800 ₽" / "1200 ₽" / "1200" — the candidate card's plain-text
 *  rendering of a price suggestion, mirroring `symbolFor` for the currency,
 *  which the model may leave unset (see `prompts.ts`: never invented). */
function formatPriceSuggestion(suggestion: {
  priceMin: string;
  priceMax?: string;
  currency?: string;
}): string {
  const symbol = suggestion.currency ? symbolFor(suggestion.currency) : "";
  const min = trimTrailingZeroCents(suggestion.priceMin);
  const max = suggestion.priceMax
    ? trimTrailingZeroCents(suggestion.priceMax)
    : undefined;
  const range = max ? `${min}–${max}` : min;
  return symbol ? `${range} ${symbol}` : range;
}

/** "Enter a price" covers empty, zero, negative and non-numeric amounts —
 *  the cases a person can produce just by clearing the field, distinct from
 *  a deliberately-entered but backwards range (see `form.priceInvalid`). */
function isAmountMissing(value: string | null): boolean {
  if (!value || !value.trim()) return true;
  const amount = Number(value);
  return !Number.isFinite(amount) || amount <= 0;
}

/** Scoped by user (see `draftScope` on `WishFormProps`) so two accounts on
 *  the same device never collide in one draft slot. */
function draftKey(scope: string | undefined): string {
  return `wishka-wish-draft:${scope}`;
}

function readDraft(
  key: string,
  candidates: AudienceOptions,
): WishFormValues | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WishFormValues> | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.title !== "string"
    )
      return null;
    return {
      ...DEFAULT_VALUES,
      ...parsed,
      audience: normalizeAudience(parsed.audience, candidates),
      // A day-old draft never carries a stale "generate on save" intent
      // forward (mirrors edit-wish-form.tsx's `toFormValues`) — re-arm
      // explicitly each time instead of silently resuming it.
      generateImage: false,
    };
  } catch {
    return null;
  }
}

/** A draft is whatever localStorage happened to hold — a wish saved before
 *  audiences existed, a half-written key, or subjects that were addressable
 *  when it was written and are not any more. Anything unrecognizable falls
 *  back to "everyone", and subjects with no candidate row are dropped, rather
 *  than proposing an audience the server would reject (see
 *  `addressableAudience`). */
function normalizeAudience(
  value: unknown,
  candidates: AudienceOptions,
): WishAudienceValue {
  if (!value || typeof value !== "object") return EVERYONE_AUDIENCE;
  const draft = value as Partial<WishAudienceValue>;
  if (draft.mode !== "restricted") return EVERYONE_AUDIENCE;
  const ids = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((id): id is string => typeof id === "string")
      : [];
  return addressableAudience(
    {
      mode: "restricted",
      groupIds: ids(draft.groupIds),
      userIds: ids(draft.userIds),
    },
    candidates,
  );
}

function writeDraft(key: string, values: WishFormValues) {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Draft persistence is a convenience, not a guarantee — losing it silently is fine.
  }
}

function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // See writeDraft.
  }
}

export function WishForm({
  initial,
  submitLabel,
  onSubmit,
  enableDraft = false,
  draftScope,
  backHref = "/",
  heading,
  parsedUrl = false,
  parsedPartial = false,
  candidates = EMPTY_AUDIENCE_OPTIONS,
  ai,
  aiDraft = false,
  baseCurrency = FALLBACK_BASE_CURRENCY,
}: WishFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftStorageKey = draftKey(draftScope);

  const [values, setValues] = useState<WishFormValues>(() => ({
    ...DEFAULT_VALUES,
    ...initial,
  }));
  const [blockedAttempt, setBlockedAttempt] = useState(false);
  const [urlError, setUrlError] = useState(false);
  // Starts editable whenever the link isn't parsed — the parsed-link display
  // row only exists to be swapped out for the plain input on request.
  const [linkEditing, setLinkEditing] = useState(!parsedUrl);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  // The audience is a whole sheet away from the submit button, so a rejected
  // audience gets its own line next to the who-can-see-it row instead of the
  // generic banner — otherwise nothing points at the control to fix.
  const [audienceError, setAudienceError] = useState<
    "empty" | "invalid" | null
  >(null);
  const [serverPriceError, setServerPriceError] = useState(false);
  const [priceBlockedAttempt, setPriceBlockedAttempt] = useState(false);

  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<PhotoError | null>(null);
  const { startUpload } = useUploadThing("wishImage");

  // The server-issued `ai` snapshot is a starting point; every suggestion
  // result carries its own `remaining`, which is what actually keeps these in
  // sync — the counters are advisory (invariant #4), the server always
  // re-checks at save/generate time.
  const [aiQuota, setAiQuota] = useState<AiQuotaSnapshot>(
    () => ai ?? { text: 0, image: 0 },
  );
  const [descSuggestState, setDescSuggestState] =
    useState<SuggestState>("idle");
  const [descSuggestion, setDescSuggestion] = useState<string | null>(null);
  const [priceSuggestState, setPriceSuggestState] =
    useState<SuggestState>("idle");
  const [priceSuggestion, setPriceSuggestion] = useState<{
    priceMin: string;
    priceMax?: string;
    currency?: string;
  } | null>(null);

  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [visibilitySheetOpen, setVisibilitySheetOpen] = useState(false);

  const [pendingDraft, setPendingDraft] = useState<WishFormValues | null>(null);
  const [draftBannerOpen, setDraftBannerOpen] = useState(false);
  const [autosaveArmed, setAutosaveArmed] = useState(!enableDraft);
  const [backDialogOpen, setBackDialogOpen] = useState(false);
  // Guards against a debounced write landing *after* handleSubmit has
  // already cleared the draft on a successful save (see handleSubmit).
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Offer to resume an existing draft (new-wish page only). Autosave stays
  // off until the offer is resolved one way or another, so it cannot
  // silently overwrite the saved draft with a blank form before the user
  // has seen the banner.
  useEffect(() => {
    if (!enableDraft) return;
    const offerDraftIfAny = () => {
      const draft = readDraft(draftStorageKey, candidates);
      if (draft && draft.title.trim()) {
        setPendingDraft(draft);
        setDraftBannerOpen(true);
      } else {
        setAutosaveArmed(true);
      }
    };
    offerDraftIfAny();
    // Mount-only: this is a one-time offer, not a live subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enableDraft || !autosaveArmed) return;
    autosaveTimerRef.current = setTimeout(() => {
      writeDraft(draftStorageKey, values);
      autosaveTimerRef.current = null;
    }, 500);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [values, enableDraft, autosaveArmed, draftStorageKey]);

  function updateValue(patch: Partial<WishFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
    setServerPriceError(false);
    setPriceBlockedAttempt(false);
    if (draftBannerOpen) {
      setDraftBannerOpen(false);
      setAutosaveArmed(true);
    }
  }

  function resumeDraft() {
    if (pendingDraft) setValues(pendingDraft);
    setDraftBannerOpen(false);
    setAutosaveArmed(true);
  }

  function handleBack() {
    if (enableDraft && values.title.trim()) {
      setBackDialogOpen(true);
      return;
    }
    router.push(backHref);
  }

  function discardDraftAndLeave() {
    clearDraft(draftStorageKey);
    setBackDialogOpen(false);
    router.push(backHref);
  }

  function keepDraftAndLeave() {
    writeDraft(draftStorageKey, values);
    setBackDialogOpen(false);
    router.push(backHref);
  }

  async function onPhotoPick(file: File | undefined) {
    if (!file) return;
    // Cheap client-side checks first: a picked file that can never upload gets
    // a message naming the actual problem instead of a late generic failure.
    if (file.type && !file.type.startsWith("image/")) {
      setImageError("notImage");
      return;
    }
    if (file.size > MAX_PICK_BYTES) {
      setImageError("tooLarge");
      return;
    }

    setImageError(null);
    setImageUploading(true);
    try {
      const small = await downscaleForWish(file);
      if (small.size > MAX_UPLOAD_BYTES) {
        setImageError("tooLarge");
        return;
      }
      const uploaded = await startUpload([small]);
      const url = uploaded?.[0]?.ufsUrl;
      if (!url) throw new Error("upload failed");
      // A picked-and-uploaded photo wins over an armed AI generation — the
      // two image sources are mutually exclusive (§6.3 AI addendum).
      updateValue({ imageUrl: url, generateImage: false });
    } catch {
      // Upload failure never blocks saving — the wish can be saved without a photo.
      setImageError("generic");
    } finally {
      setImageUploading(false);
    }
  }

  function onPriceTypeChange(next: WishFormPriceType) {
    updateValue({
      priceType: next,
      ...(next === "none" ? { priceMin: null, priceMax: null } : {}),
      ...(next !== "none" && !values.currency
        ? { currency: baseCurrency }
        : {}),
    });
  }

  /** Everything the description/price suggestion prompts need — read fresh at
   *  call time so a suggestion always reflects the card as currently filled. */
  function suggestionInput(): SuggestionInput {
    return {
      title: values.title,
      type: values.type,
      category: values.category,
      url: values.url,
      description: values.description,
    };
  }

  /** `remaining` is absent on some failure reasons (e.g. a thrown action never
   *  resolves at all) — only ever move the counter down, never guess. */
  function applyTextRemaining(remaining: number | undefined) {
    if (typeof remaining === "number") {
      setAiQuota((prev) => ({ ...prev, text: remaining }));
    }
  }

  async function handleSuggestDescription() {
    setDescSuggestState("busy");
    let result: Awaited<ReturnType<typeof suggestDescriptionAction>>;
    try {
      result = await suggestDescriptionAction(suggestionInput());
    } catch {
      setDescSuggestState("failed");
      return;
    }
    applyTextRemaining(result.remaining);
    if (result.ok) {
      setDescSuggestion(result.value.description);
      setDescSuggestState("idle");
      return;
    }
    // "error" (a resolved-but-unsuccessful call) reuses the same inline
    // failed/tryAgain UI as a rejected promise — no separate state for it.
    setDescSuggestState(result.reason === "error" ? "failed" : result.reason);
  }

  function acceptDescriptionSuggestion() {
    if (descSuggestion === null) return;
    updateValue({ description: descSuggestion });
    setDescSuggestion(null);
    setDescSuggestState("idle");
  }

  function dismissDescriptionSuggestion() {
    setDescSuggestion(null);
    setDescSuggestState("idle");
  }

  async function handleSuggestPrice() {
    setPriceSuggestState("busy");
    let result: Awaited<ReturnType<typeof suggestPriceAction>>;
    try {
      result = await suggestPriceAction(suggestionInput());
    } catch {
      setPriceSuggestState("failed");
      return;
    }
    applyTextRemaining(result.remaining);
    if (result.ok) {
      setPriceSuggestion(result.value);
      setPriceSuggestState("idle");
      return;
    }
    setPriceSuggestState(result.reason === "error" ? "failed" : result.reason);
  }

  function acceptPriceSuggestion() {
    if (!priceSuggestion) return;
    updateValue({
      priceType: priceSuggestion.priceMax ? "range" : "exact",
      priceMin: trimTrailingZeroCents(priceSuggestion.priceMin),
      priceMax: priceSuggestion.priceMax
        ? trimTrailingZeroCents(priceSuggestion.priceMax)
        : null,
      currency: priceSuggestion.currency ?? values.currency ?? baseCurrency,
    });
    setPriceSuggestion(null);
    setPriceSuggestState("idle");
  }

  function dismissPriceSuggestion() {
    setPriceSuggestion(null);
    setPriceSuggestState("idle");
  }

  /** Arming keeps whatever `imageUrl` is already on the card untouched — only
   *  a freshly picked/uploaded photo (`onPhotoPick`) disarms it, never this. */
  function toggleGenerateImage() {
    updateValue({ generateImage: !values.generateImage });
  }

  // An amount is "missing" (empty/0/non-numeric) before a range can even be
  // judged backwards — the two checks are mutually exclusive on purpose, so
  // only one message ever shows at a time.
  const priceAmountMissing =
    values.priceType === "exact"
      ? isAmountMissing(values.priceMin)
      : values.priceType === "range"
        ? isAmountMissing(values.priceMin) || isAmountMissing(values.priceMax)
        : false;
  const priceRangeInvalid =
    values.priceType === "range" &&
    !priceAmountMissing &&
    Number(values.priceMin) > Number(values.priceMax);

  const showPriceMissing = priceBlockedAttempt && priceAmountMissing;
  const showPriceInvalid =
    (priceBlockedAttempt && priceRangeInvalid) || serverPriceError;
  const priceFieldsHaveError = showPriceMissing || showPriceInvalid;

  const titleEmpty = !values.title.trim();
  // `blockedAttempt` is only ever set right after a rejected attempt (locally
  // or by the server), so it alone is the signal — not re-gated on the
  // *current* title text, which would hide a server-side "title" error
  // (e.g. over the length limit) as soon as the field held any text at all.
  // A partial parse adds a second, independent trigger: an empty title is
  // highlighted right away, before any submit attempt, since it's exactly
  // the field the parser most often leaves blank.
  const showTitleError = blockedAttempt || (parsedPartial && titleEmpty);

  async function handleSubmit() {
    if (titleEmpty) {
      setBlockedAttempt(true);
      return;
    }
    if (priceAmountMissing || priceRangeInvalid) {
      setPriceBlockedAttempt(true);
      return;
    }

    // A pending autosave firing after a successful submit's clearDraft()
    // would silently resurrect the just-cleared draft — cut it off first.
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setSubmitting(true);
    setSubmitError(false);
    setAudienceError(null);

    let result: WishFormResult;
    try {
      result = await onSubmit(values);
    } catch {
      // A server action can throw (network drop, a failed revalidate) instead
      // of resolving. Without this the button would sit on "Saving…" forever
      // behind an unhandled rejection.
      setSubmitError(true);
      return;
    } finally {
      setSubmitting(false);
    }

    if (result.ok) {
      if (enableDraft) clearDraft(draftStorageKey);
      return;
    }
    if (result.error === "title") {
      setBlockedAttempt(true);
    } else if (result.error === "price") {
      setServerPriceError(true);
    } else if (result.error === "url") {
      setUrlError(true);
    } else if (result.error === "empty_audience") {
      setAudienceError("empty");
    } else if (result.error === "invalid_subject") {
      // A subject that stopped being addressable between opening the sheet and
      // saving. Nothing on this screen can name it, so the message only says
      // the save failed — re-picking in the sheet is the way out.
      setAudienceError("invalid");
    } else {
      // Every other server code (currency, image, category, not_found, …)
      // is not a per-field error the form has a slot for — a generic,
      // localized message beats rendering the raw code to the user.
      setSubmitError(true);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t("common.back")}
          onClick={handleBack}
          className="flex h-11 w-11 flex-none cursor-pointer items-center justify-center border border-rule-2 bg-paper"
        >
          <ChevronLeft aria-hidden size={18} strokeWidth={2.2} />
        </button>
        {heading && (
          <h1 className="min-w-0 truncate font-serif text-[22px] leading-none font-semibold">
            {heading}
          </h1>
        )}
      </div>

      {parsedPartial && (
        <AlertBanner tone="warning">{t("parse.partialNotice")}</AlertBanner>
      )}

      {draftBannerOpen && (
        <AlertBanner
          tone="success"
          actionLabel={t("form.draftResume")}
          onAction={resumeDraft}
        >
          {t("form.draftBanner")}
        </AlertBanner>
      )}

      <Tabs
        fill="ink"
        ariaLabel={t("form.typeLabel")}
        value={values.type}
        onChange={(v) => updateValue({ type: v as WishFormType })}
        items={[
          { value: "product", label: t("form.typeProduct") },
          { value: "experience", label: t("form.typeExperience") },
          { value: "service", label: t("form.typeService") },
          { value: "certificate", label: t("form.typeCertificate") },
        ]}
      />

      <TextField
        label={t("form.nameLabel")}
        value={values.title}
        onChange={(event) => {
          updateValue({ title: event.target.value });
          setBlockedAttempt(false);
        }}
        error={showTitleError}
        helperText={t("form.nameRequired")}
      />

      {aiDraft && (
        <p className="-mt-3 text-[11px] text-mute-2">{t("ai.fromAi")}</p>
      )}

      {parsedUrl && !linkEditing ? (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>{t("form.linkLabel")}</span>
          <div className="flex items-center gap-2">
            <Field
              variant="parsed-link"
              value={values.url ?? ""}
              meta={t("parse.fromParser")}
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              className="flex-none px-2"
              onClick={() => setLinkEditing(true)}
            >
              {t("form.editTitle")}
            </Button>
          </div>
        </div>
      ) : (
        <TextField
          label={t("form.linkLabel")}
          value={values.url ?? ""}
          onChange={(event) => {
            updateValue({ url: event.target.value || null });
            setUrlError(false);
          }}
          placeholder="https://…"
          error={urlError}
          helperText={t("form.linkInvalid")}
        />
      )}

      <TextareaField
        label={t("form.descriptionLabel")}
        value={values.description ?? ""}
        onChange={(event) =>
          updateValue({ description: event.target.value || null })
        }
        rows={3}
      />

      {ai !== undefined &&
        (descSuggestion !== null ? (
          <SuggestionCard
            label={t("ai.suggestionLabel")}
            text={descSuggestion}
            acceptLabel={t("ai.accept")}
            dismissLabel={t("ai.dismiss")}
            onAccept={acceptDescriptionSuggestion}
            onDismiss={dismissDescriptionSuggestion}
          />
        ) : (
          <SuggestTrigger
            label={t("ai.suggestDescription")}
            busyLabel={t("ai.suggesting")}
            state={descSuggestState}
            quotaLeft={aiQuota.text}
            quotaLeftLabel={t("ai.textQuotaLeft", { count: aiQuota.text })}
            quotaExhaustedLabel={t("ai.textQuotaExhausted")}
            failedLabel={t("ai.suggestFailed")}
            tryAgainLabel={t("ai.tryAgain")}
            unavailableLabel={t("ai.unavailable")}
            titleEmpty={titleEmpty}
            onTrigger={() => void handleSuggestDescription()}
          />
        ))}

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("form.photoLabel")}</span>
        <div className="flex items-start gap-3">
          {/* A real <button> firing the hidden input, like `my-list.tsx` and
              `wish-detail.tsx` — a <label htmlFor> is not tabbable, so the
              picker was keyboard-unreachable (Phase 9 a11y audit, finding 3). */}
          <button
            type="button"
            aria-label={t("form.photoLabel")}
            disabled={imageUploading}
            onClick={() => fileInputRef.current?.click()}
            className={cx(
              "relative aspect-[4/5] w-24 flex-none cursor-pointer overflow-hidden border border-dashed border-rule-2 bg-zebra",
              imageUploading && "cursor-not-allowed opacity-70",
            )}
          >
            {values.generateImage ? (
              // Armed generation wins the preview slot over whatever photo is
              // already on the card (the photo value itself is untouched
              // underneath — disarming restores it) so the outcome of saving
              // is visible right now, not buried behind a failed job later.
              <span
                aria-hidden
                className="flex h-full w-full flex-col items-center justify-center gap-1 bg-accent-soft px-1 text-center text-[9.5px] font-medium text-accent"
              >
                {t("ai.generateArmed")}
              </span>
            ) : values.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- re-hosted CDN preview, no next/image loader configured
              <img
                src={values.imageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-full w-full items-center justify-center text-[22px] text-mute-2"
              >
                +
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={imageUploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onPhotoPick(file);
            }}
          />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            {imageUploading && (
              <span className="text-[12px] text-mute">
                {t("form.photoUploading")}
              </span>
            )}
            {!imageUploading && values.imageUrl && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-11 w-fit cursor-pointer items-center border border-rule-2 bg-paper px-4 text-[13px] font-medium text-ink hover:bg-bg"
              >
                {t("form.photoReplace")}
              </button>
            )}
            {imageError && (
              <p className="text-[11px] text-neg">
                {imageError === "tooLarge"
                  ? t("form.photoTooLarge")
                  : imageError === "notImage"
                    ? t("form.photoNotImage")
                    : t("form.photoError")}
              </p>
            )}
          </div>
        </div>

        {ai !== undefined && (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                selected={values.generateImage}
                disabled={aiQuota.image <= 0}
                onClick={toggleGenerateImage}
                className={aiQuota.image <= 0 ? "opacity-60" : undefined}
              >
                {t("ai.generateImage")}
              </FilterChip>
              {/* The armed state itself now shows in the photo preview slot
                  above (see the thumbnail label) — no need to say it twice. */}
            </div>
            <p className="text-[11px] text-mute-2">
              {aiQuota.image <= 0
                ? t("ai.imageQuotaExhausted")
                : t("ai.imageQuotaLeft", { count: aiQuota.image })}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("form.priceLabel")}</span>
        <Tabs
          fill="accent"
          ariaLabel={t("form.priceLabel")}
          value={values.priceType}
          onChange={(v) => onPriceTypeChange(v as WishFormPriceType)}
          items={[
            { value: "exact", label: t("form.priceExact") },
            { value: "range", label: t("form.priceRange") },
            { value: "none", label: t("form.priceNone") },
          ]}
        />
        {values.priceType !== "none" && (
          <div className="flex items-center gap-2">
            {values.priceType === "exact" ? (
              <Field
                inputMode="decimal"
                aria-label={t("form.priceExact")}
                className="flex-1"
                error={priceFieldsHaveError}
                value={values.priceMin ?? ""}
                onChange={(event) =>
                  updateValue({ priceMin: event.target.value || null })
                }
              />
            ) : (
              <>
                <Field
                  inputMode="decimal"
                  aria-label={t("form.priceFrom")}
                  placeholder={t("form.priceFrom")}
                  className="flex-1"
                  error={priceFieldsHaveError}
                  value={values.priceMin ?? ""}
                  onChange={(event) =>
                    updateValue({ priceMin: event.target.value || null })
                  }
                />
                <Field
                  inputMode="decimal"
                  aria-label={t("form.priceTo")}
                  placeholder={t("form.priceTo")}
                  className="flex-1"
                  error={priceFieldsHaveError}
                  value={values.priceMax ?? ""}
                  onChange={(event) =>
                    updateValue({ priceMax: event.target.value || null })
                  }
                />
              </>
            )}
            <button
              type="button"
              aria-label={t("form.currencyLabel")}
              onClick={() => setCurrencySheetOpen(true)}
              className="flex min-h-11 flex-none cursor-pointer items-center gap-1.5 border border-rule-2 bg-paper px-3 font-mono text-[13px]"
            >
              {symbolFor(values.currency)} {values.currency ?? ""}
              <ChevronDown aria-hidden size={12} strokeWidth={2.2} />
            </button>
          </div>
        )}
        {showPriceMissing && (
          <p className="text-[11px] text-neg">{t("form.priceMissing")}</p>
        )}
        {showPriceInvalid && !showPriceMissing && (
          <p className="text-[11px] text-neg">{t("form.priceInvalid")}</p>
        )}
      </div>

      {ai !== undefined &&
        (priceSuggestion !== null ? (
          <SuggestionCard
            label={t("ai.suggestionLabel")}
            text={formatPriceSuggestion(priceSuggestion)}
            acceptLabel={t("ai.accept")}
            dismissLabel={t("ai.dismiss")}
            onAccept={acceptPriceSuggestion}
            onDismiss={dismissPriceSuggestion}
          />
        ) : (
          <SuggestTrigger
            label={t("ai.suggestPrice")}
            busyLabel={t("ai.suggesting")}
            state={priceSuggestState}
            quotaLeft={aiQuota.text}
            quotaLeftLabel={t("ai.textQuotaLeft", { count: aiQuota.text })}
            quotaExhaustedLabel={t("ai.textQuotaExhausted")}
            failedLabel={t("ai.suggestFailed")}
            tryAgainLabel={t("ai.tryAgain")}
            unavailableLabel={t("ai.unavailable")}
            titleEmpty={titleEmpty}
            onTrigger={() => void handleSuggestPrice()}
          />
        ))}

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("form.priorityLabel")}</span>
        <div className="flex gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={values.priority === p}
              onClick={() => updateValue({ priority: p })}
              className={cx(
                "flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 border bg-paper px-1.5 py-3 text-center",
                values.priority === p
                  ? "border-accent shadow-[inset_0_0_0_1px_var(--accent)]"
                  : "border-rule-2",
              )}
            >
              <PriorityFlag priority={p} label={t(`wish.priority.${p}`)} />
            </button>
          ))}
        </div>
      </div>

      {/* The real control is the sr-only checkbox below — focusable but
          invisible, so the label carries the focus cue for it (Phase 9 a11y
          audit, finding 4). */}
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 border border-dashed border-rule-2 bg-paper px-3 py-2.5 focus-within:border-accent focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
        <DreamStamp size="sm" label={t("form.dreamLabel")} />
        <span className="flex-1 text-[11px] leading-[1.4] text-mute">
          {t("form.dreamHint")}
        </span>
        <input
          type="checkbox"
          checked={values.isDream}
          onChange={(event) => updateValue({ isDream: event.target.checked })}
          className="sr-only"
        />
        <span
          aria-hidden
          className={cx(
            "relative h-[22px] w-[38px] flex-none border",
            values.isDream
              ? "border-accent bg-accent-soft"
              : "border-rule-2 bg-zebra",
          )}
        >
          <span
            className={cx(
              "absolute top-[2px] h-[16px] w-[16px]",
              values.isDream ? "left-[18px] bg-accent" : "left-[2px] bg-mute-2",
            )}
          />
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("form.categoryLabel")}</span>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_KEYS.map((key) => (
            <FilterChip
              key={key}
              selected={values.category === key}
              onClick={() =>
                updateValue({ category: values.category === key ? null : key })
              }
            >
              {t(`wish.category.${key}`)}
            </FilterChip>
          ))}
        </div>
      </div>

      <TextareaField
        label={t("form.notesLabel")}
        placeholder={t("form.notesPlaceholder")}
        value={values.notes ?? ""}
        onChange={(event) => updateValue({ notes: event.target.value || null })}
        rows={3}
      />

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setVisibilitySheetOpen(true)}
          className="flex min-h-11 cursor-pointer items-center gap-2 border border-rule-2 bg-paper px-3 py-2.5 text-left"
        >
          <span className="flex flex-1 flex-col gap-0.5">
            <span className={LABEL_CLASS}>{t("form.visibilityLabel")}</span>
            <span className="text-[13px]">
              {values.audience.mode === "everyone"
                ? t("visibility.summaryEveryone")
                : t("visibility.summaryRestricted", {
                    count: audienceSubjectCount(values.audience),
                  })}
            </span>
          </span>
          <ChevronDown aria-hidden size={12} strokeWidth={2.2} />
        </button>
        {audienceError && (
          <p className="text-[11px] text-neg">
            {audienceError === "empty"
              ? t("visibility.emptyAudience")
              : t("common.actionFailed")}
          </p>
        )}
      </div>

      {submitError && (
        <AlertBanner tone="error">{t("form.errorGeneric")}</AlertBanner>
      )}

      <Button
        type="button"
        variant="primary"
        className={cx(
          "w-full",
          titleEmpty && !submitting && "cursor-not-allowed opacity-60",
        )}
        loading={submitting}
        disabled={submitting}
        aria-disabled={titleEmpty || submitting}
        onClick={() => void handleSubmit()}
      >
        {submitting ? t("form.saving") : submitLabel}
      </Button>

      <CurrencySheet
        open={currencySheetOpen}
        onClose={() => setCurrencySheetOpen(false)}
        value={values.currency}
        baseCurrency={baseCurrency}
        onSelect={(code) => updateValue({ currency: code })}
      />

      <VisibilitySheet
        open={visibilitySheetOpen}
        onClose={() => setVisibilitySheetOpen(false)}
        value={values.audience}
        candidates={candidates}
        onConfirm={(audience) => {
          updateValue({ audience });
          setAudienceError(null);
        }}
      />

      <Dialog
        open={backDialogOpen}
        onClose={() => setBackDialogOpen(false)}
        title={t("form.draftTitle")}
        actions={[
          {
            label: t("form.draftDiscard"),
            onClick: discardDraftAndLeave,
            tone: "neutral",
          },
          {
            label: t("form.draftKeep"),
            onClick: keepDraftAndLeave,
            tone: "accent",
          },
        ]}
      />
    </div>
  );
}

/** Accepted/dismissed candidate card — shared shape for the description and
 *  price suggestion affordances (§6.3 AI addendum). */
function SuggestionCard({
  label,
  text,
  acceptLabel,
  dismissLabel,
  onAccept,
  onDismiss,
}: {
  label: string;
  text: string;
  acceptLabel: string;
  dismissLabel: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border border-dashed border-rule-2 bg-zebra p-3">
      <span className="text-[10.5px] font-semibold tracking-[0.1em] text-mute uppercase">
        {label}
      </span>
      <p className="text-[13px]" style={{ lineHeight: "var(--lead-prose)" }}>
        {text}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          className="flex-1"
          onClick={onAccept}
        >
          {acceptLabel}
        </Button>
        <Button type="button" className="flex-1" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
    </div>
  );
}

/** The button that kicks off a suggestion, plus its busy/failed/quota states
 *  — shared by description and price. `quotaLeft` gates the trigger itself:
 *  the UI counter is advisory (invariant #4), but there is no reason to send
 *  a request the client already knows the server will refuse. */
function SuggestTrigger({
  label,
  busyLabel,
  state,
  quotaLeft,
  quotaLeftLabel,
  quotaExhaustedLabel,
  failedLabel,
  tryAgainLabel,
  unavailableLabel,
  titleEmpty,
  onTrigger,
}: {
  label: string;
  busyLabel: string;
  state: SuggestState;
  quotaLeft: number;
  /** Pre-rendered `ai.textQuotaLeft` ICU string — refreshes from every
   *  `AiResult.remaining`, same as the generate-image counter. */
  quotaLeftLabel: string;
  quotaExhaustedLabel: string;
  failedLabel: string;
  tryAgainLabel: string;
  unavailableLabel: string;
  /** The action itself refuses a title-less input with a plain "error" —
   *  disabling here avoids a dead retry-forever loop on a fresh form. */
  titleEmpty: boolean;
  onTrigger: () => void;
}) {
  const busy = state === "busy";
  const exhausted = quotaLeft <= 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className={cx("w-fit px-0", exhausted && "opacity-60")}
          loading={busy}
          disabled={busy || exhausted || titleEmpty}
          onClick={onTrigger}
        >
          {busy ? busyLabel : label}
        </Button>
        {state === "failed" && (
          <>
            <span className="text-[11px] text-neg">{failedLabel}</span>
            <Button
              type="button"
              variant="ghost"
              className="px-0"
              disabled={exhausted || titleEmpty}
              onClick={onTrigger}
            >
              {tryAgainLabel}
            </Button>
          </>
        )}
        {state === "unavailable" && (
          <span className="text-[11px] text-mute-2">{unavailableLabel}</span>
        )}
      </div>
      {/* Exhausted is shown here unconditionally — mount-time (quota already
          at 0) and post-refusal (state === "quota", which always lands with
          remaining 0) both read the same way, so one line covers both
          instead of only the latter. */}
      <p className="text-[11px] text-mute-2">
        {exhausted ? quotaExhaustedLabel : quotaLeftLabel}
      </p>
    </div>
  );
}
