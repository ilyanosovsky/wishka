import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Multi-select square chip — filters, tag pickers. min-h-11 (44px): these are
 *  the list filters and the whole category picker in the wish form, so they hold
 *  the kit's tap-target rule (§3.1) like every other control. */
export function FilterChip({
  selected = false,
  className,
  children,
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 border px-3 text-[12px]",
        selected
          ? "border-ink bg-ink font-medium text-paper"
          : "border-rule-2 bg-paper text-mute",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export interface StaticChipProps {
  className?: string;
  children: ReactNode;
}

/** Static tag — categories, non-interactive labels. */
export function TagChip({ className, children }: StaticChipProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center bg-zebra px-2 py-0.5 text-[11px] text-mute",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Red family — "do not gift this" style flags. Not in the Tailwind theme map, hence arbitrary var() refs. */
export function NoGiftChip({ className, children }: StaticChipProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center border border-[var(--red-rule)] bg-[var(--red-soft)] px-2 py-0.5 text-[11px] text-[var(--red-txt)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
