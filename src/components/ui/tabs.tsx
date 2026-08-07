"use client";

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
 *  targeting the same CSS property race on specificity in Tailwind's output order. */
export function Tabs({
  items,
  value,
  onChange,
  fill = "ink",
  className,
  ariaLabel,
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cx("inline-flex border border-rule-2", className)}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
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
                  active ? "text-paper/60" : "text-mute-2",
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
