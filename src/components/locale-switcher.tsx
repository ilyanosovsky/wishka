"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRovingRadio } from "@/components/ui/use-roving-radio";
import { setLocale } from "@/i18n/actions";
import { LOCALES, type Locale } from "@/i18n/config";

/** RU/EN segmented switch; persists via cookie and re-renders the tree. */
export function LocaleSwitcher() {
  const t = useTranslations("locale");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function select(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  const roving = useRovingRadio({
    values: LOCALES,
    value: (LOCALES as readonly string[]).includes(locale)
      ? (locale as Locale)
      : null,
    onChange: select,
  });

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      onKeyDown={roving.onKeyDown}
      className={`inline-flex border border-rule-2 ${isPending ? "opacity-75" : ""}`}
    >
      {LOCALES.map((value) => {
        const active = locale === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            tabIndex={roving.tabIndex(value)}
            ref={roving.itemRef(value)}
            onClick={() => select(value)}
            className={`min-h-11 cursor-pointer border-r border-rule-2 px-3.5 text-[12px] uppercase tracking-[0.1em] last:border-r-0 ${
              active ? "bg-ink font-semibold text-paper" : "bg-paper text-mute"
            }`}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}
