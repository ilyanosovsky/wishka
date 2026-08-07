import { Plus } from "lucide-react";
import type { ButtonHTMLAttributes, CSSProperties } from "react";

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface FabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — the FAB has no visible label. */
  ariaLabel: string;
  /** CSS length for `bottom`. Default clears a 56px TabBar + 16px gutter + the safe area.
   *  Kept as inline style, not a Tailwind class: the value is computed per-caller, and Tailwind
   *  can't pick up a runtime-interpolated arbitrary class at build time. */
  bottomOffset?: string;
}

/** Square FAB (Directions §turn-3): 56px, 2px ink border, accent fill, fixed bottom-right. */
export function Fab({
  ariaLabel,
  bottomOffset = "calc(56px + 16px + env(safe-area-inset-bottom))",
  className,
  style,
  ...props
}: FabProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      style={{ ...style, bottom: bottomOffset } as CSSProperties}
      className={cx(
        "fixed right-4 z-40 flex h-14 w-14 items-center justify-center border-2 border-ink bg-accent text-paper",
        className,
      )}
      {...props}
    >
      <Plus aria-hidden size={22} strokeWidth={2.4} />
    </button>
  );
}
