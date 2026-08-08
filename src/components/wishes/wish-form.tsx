"use client";

import { ChevronDown, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { DreamStamp, PriorityFlag } from "@/components/ui/badges";
import { AlertBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextareaField, TextField } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { CATEGORY_KEYS } from "@/lib/categories";
import { CURRENCIES, type CurrencyCode } from "@/lib/currencies";
import { useUploadThing } from "@/lib/uploadthing-client";
import { downscaleForWish } from "@/lib/wish-image";
import { CurrencySheet } from "./currency-sheet";

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
};

export type WishFormResult = { ok: true } | { ok: false; error: string };

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
  /** True when the Link field's initial value came from the URL parser
   *  (§6.3 step 3, "спарсено") — renders it as a read-only parsed-link row
   *  with a small edit affordance instead of the usual editable input. */
  parsedUrl?: boolean;
  /** True when the parser only partially filled the card (§6.3 step 2,
   *  "Частично") — shows a partial-notice banner and highlights an empty
   *  title immediately, without waiting for a blocked submit attempt. */
  parsedPartial?: boolean;
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
};

/**
 * No profile/base-currency prop reaches this component (out of this file's
 * ownership boundary — see the Phase 4 task split), so the currency sheet's
 * "base currency" anchor is a fixed fallback rather than the signed-in
 * user's actual base currency. Flagged in the Phase 4 report as a deviation;
 * a real base-currency prop can replace this once a caller can supply one.
 */
const FALLBACK_BASE_CURRENCY: CurrencyCode = "USD";

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

function readDraft(key: string): WishFormValues | null {
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
    return { ...DEFAULT_VALUES, ...parsed };
  } catch {
    return null;
  }
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
  parsedUrl = false,
  parsedPartial = false,
}: WishFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const fileInputId = useId();
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
  const [serverPriceError, setServerPriceError] = useState(false);
  const [priceBlockedAttempt, setPriceBlockedAttempt] = useState(false);

  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { startUpload } = useUploadThing("wishImage");

  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);

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
      const draft = readDraft(draftStorageKey);
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
    setImageError(false);
    setImageUploading(true);
    try {
      const small = await downscaleForWish(file);
      const uploaded = await startUpload([small]);
      const url = uploaded?.[0]?.ufsUrl;
      if (!url) throw new Error("upload failed");
      updateValue({ imageUrl: url });
    } catch {
      // Upload failure never blocks saving — the wish can be saved without a photo.
      setImageError(true);
    } finally {
      setImageUploading(false);
    }
  }

  function onPriceTypeChange(next: WishFormPriceType) {
    updateValue({
      priceType: next,
      ...(next === "none" ? { priceMin: null, priceMax: null } : {}),
      ...(next !== "none" && !values.currency
        ? { currency: FALLBACK_BASE_CURRENCY }
        : {}),
    });
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
    const result = await onSubmit(values);
    setSubmitting(false);

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
    } else {
      // Every other server code (currency, image, category, not_found, …)
      // is not a per-field error the form has a slot for — a generic,
      // localized message beats rendering the raw code to the user.
      setSubmitError(true);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-6">
      <div>
        <button
          type="button"
          aria-label={t("common.back")}
          onClick={handleBack}
          className="flex h-11 w-11 cursor-pointer items-center justify-center border border-rule-2 bg-paper"
        >
          <ChevronLeft aria-hidden size={18} strokeWidth={2.2} />
        </button>
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

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("form.photoLabel")}</span>
        <div className="flex items-start gap-3">
          <label
            htmlFor={fileInputId}
            className={cx(
              "relative aspect-[4/5] w-24 flex-none cursor-pointer overflow-hidden border border-dashed border-rule-2 bg-zebra",
              imageUploading && "pointer-events-none opacity-70",
            )}
          >
            {values.imageUrl ? (
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
          </label>
          <input
            id={fileInputId}
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
              <label
                htmlFor={fileInputId}
                className="inline-flex min-h-11 w-fit cursor-pointer items-center border border-rule-2 bg-paper px-4 text-[13px] font-medium text-ink hover:bg-bg"
              >
                {t("form.photoReplace")}
              </label>
            )}
            {imageError && (
              <p className="text-[11px] text-neg">{t("form.photoError")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("form.priceLabel")}</span>
        <Tabs
          fill="accent"
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

      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 border border-dashed border-rule-2 bg-paper px-3 py-2.5">
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

      {/* Visibility — stub until Phase 8 (RLS-backed "Кому видно" sheet). */}
      <div className="flex min-h-11 flex-col gap-0.5 border border-rule-2 bg-paper px-3 py-2.5 text-mute">
        <span className={LABEL_CLASS}>{t("form.visibilityLabel")}</span>
        <span className="text-[13px]">{t("form.visibilityEveryone")}</span>
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
        baseCurrency={FALLBACK_BASE_CURRENCY}
        onSelect={(code) => updateValue({ currency: code })}
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
