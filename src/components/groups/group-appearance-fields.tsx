"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { GROUP_COLORS } from "@/lib/group-colors";
import { groupSwatchClass } from "./group-mark";

/**
 * Emoji + colour, shared by the create sheet and «Эмодзи и цвет» (§6.7).
 *
 * Both are optional, and neither picker has a separate "none" control: tapping
 * the current choice clears it. That keeps the row to one row of 44px targets
 * and needs no copy for the empty option.
 */

/** Fixed palette — a full emoji keyboard is out of scope, and the data layer
 *  caps the stored value at 8 characters anyway. */
export const GROUP_EMOJI = [
  "🎁",
  "🏠",
  "🎂",
  "🌿",
  "⭐",
  "🎓",
  "🐾",
  "✈️",
] as const;

const LABEL_CLASS =
  "text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute";

export type GroupAppearanceFieldsProps = {
  emoji: string | null;
  color: string | null;
  onEmojiChange: (emoji: string | null) => void;
  onColorChange: (color: string | null) => void;
};

export function GroupAppearanceFields({
  emoji,
  color,
  onEmojiChange,
  onColorChange,
}: GroupAppearanceFieldsProps) {
  const t = useTranslations("groups");

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL_CLASS}>{t("emojiLabel")}</span>
        <div role="group" aria-label={t("emojiLabel")} className="flex gap-1.5">
          {GROUP_EMOJI.map((option) => {
            const selected = option === emoji;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => onEmojiChange(selected ? null : option)}
                className={`flex h-11 w-11 flex-none items-center justify-center border text-[19px] ${
                  selected ? "border-ink bg-zebra" : "border-rule-2 bg-paper"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 pt-3">
        <span className={LABEL_CLASS}>{t("colorLabel")}</span>
        <div role="group" aria-label={t("colorLabel")} className="flex gap-1.5">
          {GROUP_COLORS.map((option, index) => {
            const selected = option === color;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                /* The keys are internal tokens, so the swatches are numbered
                   rather than named — nothing untranslated reaches the user. */
                aria-label={`${t("colorLabel")} ${index + 1}`}
                onClick={() => onColorChange(selected ? null : option)}
                /* Selection is an inset ring in the swatch's own foreground
                   (every swatch pairs its fill with a legible one — same reason
                   the tick works). `outline` is reserved for :focus-visible;
                   spending it here made "selected" and "focused" the same
                   picture. */
                className={`flex h-11 w-11 flex-none cursor-pointer items-center justify-center border ${groupSwatchClass(
                  option,
                )} ${selected ? "shadow-[inset_0_0_0_2px_currentColor]" : ""}`}
              >
                {/* The tick is `currentColor`: every swatch pairs its fill with
                    a legible foreground, so it reads on all of them. */}
                {selected && <Check aria-hidden size={16} strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
