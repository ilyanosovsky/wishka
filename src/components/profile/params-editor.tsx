"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { updatePublicParams } from "@/app/profile/actions";
import {
  KNOWN_SIZE_KEYS,
  type KnownSizeKey,
} from "@/app/profile/params-sanitize";
import { Button } from "@/components/ui/button";
import { NoGiftChip, TagChip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { InfoToast } from "@/components/ui/toast";

/**
 * §6.6 public-parameters editor, embedded directly under the profile
 * identity header (no bottom sheet — the section lives on the page itself).
 * Save is explicit (a single button) rather than autosave-on-blur, per the
 * Phase 7a task split: simpler to reason about and to test.
 */

export type ParamsEditorInitial = {
  sizes: Record<string, string>;
  tastes: string[];
  noGift: string[];
};

export type ParamsEditorProps = {
  initial: ParamsEditorInitial;
};

const SECTION_CLASS =
  "flex flex-col gap-3 border border-rule-2 bg-paper p-4 shadow-[var(--shadow-line)]";
const HEADING_CLASS =
  "font-mono text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute";
const ROW_LABEL_CLASS =
  "text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute";

const SIZE_LABEL_KEY: Record<KnownSizeKey, string> = {
  clothing: "params.sizeClothing",
  shoes: "params.sizeShoes",
  ring: "params.sizeRing",
  head: "params.sizeHead",
};

/**
 * 24px is the visual size the Paper Ledger chip row can carry; the pseudo
 * element widens the *hit* area to 44px without adding a single pixel of
 * layout, so the tags keep their spacing (§3.1 / WCAG 2.5.8).
 */
const REMOVE_BUTTON_CLASS =
  "relative flex h-6 w-6 flex-none cursor-pointer items-center justify-center text-mute-2 before:absolute before:-inset-2.5 before:content-[''] hover:text-ink";

function isSizesEmpty(sizes: Record<string, string>): boolean {
  return Object.values(sizes).every((value) => !value.trim());
}

/** Mirror of `sanitizeSizes`' empty-drop rule (params-sanitize.ts): a row left
 *  blank is not saved, so it must not survive the save locally either — it
 *  used to keep rendering until the next reload silently removed it. */
function withoutBlankValues(
  sizes: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sizes).filter(([, value]) => value.trim() !== ""),
  );
}

/** Anything the four known rows don't cover — «рост», «любимый цвет», … The
 *  sanitizer already tolerates arbitrary keys under the same caps, so this is
 *  purely the write-side UI §6.6 asks for. */
function customKeysOf(sizes: Record<string, string>): string[] {
  const known = new Set<string>(KNOWN_SIZE_KEYS);
  return Object.keys(sizes).filter((key) => !known.has(key));
}

/** Client-side mirror of `sanitizePublicParams`' caps (80 chars, 30 keys
 *  total) so the editor can't offer to write something the server drops. */
const CUSTOM_KEY_MAX_LENGTH = 80;
const MAX_CUSTOM_PARAMS = 30 - KNOWN_SIZE_KEYS.length;

export function ParamsEditor({ initial }: ParamsEditorProps) {
  const t = useTranslations();
  const tasteFieldId = useId();
  const noGiftFieldId = useId();
  const customFieldId = useId();

  const [sizes, setSizes] = useState<Record<string, string>>(initial.sizes);
  const [tastes, setTastes] = useState<string[]>(initial.tastes);
  const [noGift, setNoGift] = useState<string[]>(initial.noGift);
  const [tasteDraft, setTasteDraft] = useState("");
  const [noGiftDraft, setNoGiftDraft] = useState("");
  const [customNameDraft, setCustomNameDraft] = useState("");
  // The one visible reason a name was refused (duplicate, or the cap). The
  // field's own error state carries it — `params.*` has no string for this and
  // the copy catalogue is not this component's to grow.
  const [customNameRejected, setCustomNameRejected] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const allEmpty =
    isSizesEmpty(sizes) && tastes.length === 0 && noGift.length === 0;

  const customKeys = customKeysOf(sizes);

  function setSizeValue(key: string, value: string) {
    setSizes((prev) => ({ ...prev, [key]: value }));
  }

  function addCustomParam() {
    // Keys are lower-cased here for the same reason the sanitizer does it:
    // «Рост» and «рост» must not become two rows on the public profile.
    const key = customNameDraft
      .trim()
      .slice(0, CUSTOM_KEY_MAX_LENGTH)
      .toLowerCase();
    if (!key) return;

    // Guard BEFORE clearing the draft. Clearing first made a refused name look
    // like an accepted one: the input emptied and nothing else happened.
    // `Object.hasOwn`, not `in` — `in` also matches `constructor`/`toString`,
    // which would silently refuse three perfectly ordinary parameter names.
    const isKnownRow = (KNOWN_SIZE_KEYS as readonly string[]).includes(key);
    if (
      isKnownRow ||
      Object.hasOwn(sizes, key) ||
      customKeys.length >= MAX_CUSTOM_PARAMS
    ) {
      setCustomNameRejected(true);
      return;
    }

    setCustomNameRejected(false);
    setCustomNameDraft("");
    setSizes((prev) => ({ ...prev, [key]: "" }));
  }

  function removeCustomParam(key: string) {
    setSizes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function addTaste() {
    const value = tasteDraft.trim();
    setTasteDraft("");
    if (!value || tastes.includes(value)) return;
    setTastes((prev) => [...prev, value]);
  }

  function removeTaste(value: string) {
    setTastes((prev) => prev.filter((item) => item !== value));
  }

  function addNoGift() {
    const value = noGiftDraft.trim();
    setNoGiftDraft("");
    if (!value || noGift.includes(value)) return;
    setNoGift((prev) => [...prev, value]);
  }

  function removeNoGift(value: string) {
    setNoGift((prev) => prev.filter((item) => item !== value));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(false);
    // What you see is what saved: the server drops blank-valued keys, so drop
    // them here too rather than leave a row on screen that no longer exists.
    const kept = withoutBlankValues(sizes);
    setSizes(kept);
    setCustomNameRejected(false);
    try {
      const result = await updatePublicParams({
        sizes: kept,
        tastes,
        noGift,
      });
      if (result.ok) setSaved(true);
      else setSaveError(true);
    } catch {
      // A rejected action (network / server error) must still clear the
      // loading state, or the button stays disabled forever.
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {allEmpty && (
        <p className="text-[12px] text-mute">{t("params.fillHint")}</p>
      )}

      <section className={SECTION_CLASS}>
        <h2 className={HEADING_CLASS}>{t("params.editSizes")}</h2>
        <div className="flex flex-col gap-2.5">
          {KNOWN_SIZE_KEYS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <span className={ROW_LABEL_CLASS}>{t(SIZE_LABEL_KEY[key])}</span>
              <Field
                aria-label={t(SIZE_LABEL_KEY[key])}
                value={sizes[key] ?? ""}
                placeholder={t("params.empty")}
                onChange={(event) => setSizeValue(key, event.target.value)}
              />
            </div>
          ))}

          {customKeys.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <span className={ROW_LABEL_CLASS}>{key}</span>
              <div className="flex items-center gap-2">
                <Field
                  aria-label={key}
                  value={sizes[key] ?? ""}
                  placeholder={t("params.empty")}
                  onChange={(event) => setSizeValue(key, event.target.value)}
                  className="flex-1"
                />
                <button
                  type="button"
                  aria-label={t("common.removeItem", { name: key })}
                  onClick={() => removeCustomParam(key)}
                  className={REMOVE_BUTTON_CLASS}
                >
                  <X aria-hidden size={12} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Name only: the new row lands in the list above with its own value
            field, exactly like the four known ones — one control, no second
            input whose accessible name we would have to invent. */}
        <div className="flex items-center gap-2">
          <Field
            id={customFieldId}
            aria-label={t("params.customName")}
            value={customNameDraft}
            placeholder={t("params.customName")}
            maxLength={CUSTOM_KEY_MAX_LENGTH}
            error={customNameRejected}
            onChange={(event) => {
              setCustomNameDraft(event.target.value);
              setCustomNameRejected(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomParam();
              }
            }}
            className="flex-1"
          />
          <Button
            type="button"
            className="flex-none"
            disabled={!customNameDraft.trim()}
            onClick={addCustomParam}
          >
            {t("params.addParam")}
          </Button>
        </div>
      </section>

      <section className={SECTION_CLASS}>
        <h2 className={HEADING_CLASS}>{t("params.editTastes")}</h2>
        {tastes.length === 0 ? (
          <p className="text-[12px] text-mute-2">{t("params.empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tastes.map((taste) => (
              <span key={taste} className="inline-flex items-center gap-1">
                <TagChip>{taste}</TagChip>
                <button
                  type="button"
                  aria-label={t("common.removeItem", { name: taste })}
                  onClick={() => removeTaste(taste)}
                  className={REMOVE_BUTTON_CLASS}
                >
                  <X aria-hidden size={12} strokeWidth={2.4} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Field
            id={tasteFieldId}
            aria-label={t("params.addTaste")}
            value={tasteDraft}
            placeholder={t("params.tastePlaceholder")}
            onChange={(event) => setTasteDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTaste();
              }
            }}
            className="flex-1"
          />
          <Button type="button" className="flex-none" onClick={addTaste}>
            {t("params.addTaste")}
          </Button>
        </div>
      </section>

      <section className={SECTION_CLASS}>
        <h2 className={HEADING_CLASS}>{t("params.editNoGift")}</h2>
        {noGift.length === 0 ? (
          <p className="text-[12px] text-mute-2">{t("params.empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {noGift.map((item) => (
              <span key={item} className="inline-flex items-center gap-1">
                <NoGiftChip>{item}</NoGiftChip>
                <button
                  type="button"
                  aria-label={t("common.removeItem", { name: item })}
                  onClick={() => removeNoGift(item)}
                  className={REMOVE_BUTTON_CLASS}
                >
                  <X aria-hidden size={12} strokeWidth={2.4} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Field
            id={noGiftFieldId}
            aria-label={t("params.addNoGift")}
            value={noGiftDraft}
            placeholder={t("params.addNoGift")}
            onChange={(event) => setNoGiftDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addNoGift();
              }
            }}
            className="flex-1"
          />
          <Button type="button" className="flex-none" onClick={addNoGift}>
            {t("params.addNoGift")}
          </Button>
        </div>
      </section>

      <Button
        type="button"
        variant="primary"
        className="w-full"
        loading={saving}
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {t("params.save")}
      </Button>

      <InfoToast
        open={saved}
        message={t("params.saved")}
        onDismiss={() => setSaved(false)}
      />
      <InfoToast
        open={saveError}
        message={t("common.actionFailed")}
        onDismiss={() => setSaveError(false)}
      />
    </div>
  );
}
