"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useRovingRadio } from "@/components/ui/use-roving-radio";
import {
  applyTheme,
  getServerThemeSnapshot,
  getThemeSnapshot,
  subscribeTheme,
  THEMES,
} from "@/lib/theme";

/** Segmented Light/Dark/System control — Paper Ledger ".tabs" pattern. */
export function ThemeSwitcher() {
  const t = useTranslations("theme");
  // null during SSR/hydration: the persisted value only exists in the browser.
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const roving = useRovingRadio({
    values: THEMES,
    value: theme,
    onChange: applyTheme,
  });

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      onKeyDown={roving.onKeyDown}
      className="inline-flex border border-rule-2"
    >
      {THEMES.map((value) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            tabIndex={roving.tabIndex(value)}
            ref={roving.itemRef(value)}
            onClick={() => applyTheme(value)}
            className={`min-h-11 cursor-pointer border-r border-rule-2 px-3.5 text-[12px] last:border-r-0 ${
              active ? "bg-ink font-semibold text-paper" : "bg-paper text-mute"
            }`}
          >
            {t(value)}
          </button>
        );
      })}
    </div>
  );
}
