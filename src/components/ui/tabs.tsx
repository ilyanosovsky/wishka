"use client";

import { useRovingRadio } from "./use-roving-radio";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export type TabsFill = "ink" | "accent";

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  /** "ink" — filters, view switcher. "accent" — price mode toggle. */
  fill?: TabsFill;
  className?: string;
  ariaLabel?: string;
}

const FILL_CLASS: Record<TabsFill, string> = {
  ink: "bg-ink text-paper",
  accent: "bg-accent text-paper",
};

/** `.tabs`/`.tab` segmented control. The active tab swaps its whole bg/text pair at once — never layers
 *  a conflicting background or text-color utility on top of the inactive default, since two classes
 *  targeting the same CSS property race on specificity in Tailwind's output order.
 *
 *  Keyboard: the strip is one tab stop and Arrow keys move the selection
 *  (`useRovingRadio` — a tablist and a radiogroup share that contract). */
export function Tabs({
  items,
  value,
  onChange,
  fill = "ink",
  className,
  ariaLabel,
}: TabsProps) {
  const roving = useRovingRadio({
    values: items.map((item) => item.value),
    value,
    onChange,
  });

  // max-w-full + overflow-x-auto: labels are nowrap, so a row that cannot fit
  // (four RU type tabs on a narrow screen) scrolls inside its own box instead
  // of painting over the page padding.
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={roving.onKeyDown}
      className={cx(
        "inline-flex max-w-full overflow-x-auto border border-rule-2",
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={roving.tabIndex(item.value)}
            onClick={() => onChange(item.value)}
            className={cx(
              "flex min-h-11 items-center gap-1.5 whitespace-nowrap border-rule-2 px-3.5 text-[12px]",
              index < items.length - 1 && "border-r",
              active
                ? cx(FILL_CLASS[fill], "font-semibold")
                : "bg-paper text-mute",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cx(
                  "font-mono text-[10px]",
                  /* /80, not /60: at 10px on the ink fill the count is body
                     text, and 60% left it at 3.79:1 in dark. */
                  active ? "text-paper/80" : "text-mute-2",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
