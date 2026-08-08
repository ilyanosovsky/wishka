import { Lock } from "lucide-react";

/** Two scales from the mini-system: `sm` is the wish-card scale (8.5–9px),
 *  `md` the standalone chip scale (9–11px). Explicit variants instead of a
 *  className override so Tailwind never has to arbitrate a conflict. */
export type BadgeSize = "sm" | "md";

export type WishStatus = "free" | "reserved" | "reservedByYou" | "gifted";
export type WishPriority = "want" | "nice" | "idea";

/** `className` on these badges is for positioning only (absolute/inset). */
type Positionable = { className?: string };

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const STATUS_TONE: Record<WishStatus, string> = {
  free: "border-[var(--green-rule)] bg-accent-soft text-accent",
  reserved: "border-rule-2 bg-zebra text-mute",
  reservedByYou: "border-accent bg-accent text-paper",
  gifted: "border-ink bg-ink text-paper",
};

export function StatusBadge({
  status,
  label,
  size = "md",
  className,
}: { status: WishStatus; label: string; size?: BadgeSize } & Positionable) {
  return (
    <span
      className={cx(
        "inline-block border font-semibold tracking-[var(--track-badge)] whitespace-nowrap uppercase",
        size === "sm"
          ? "px-[7px] py-0.5 text-[8.5px]"
          : "px-2 py-[3px] text-[9px]",
        STATUS_TONE[status],
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Rotated ochre stamp slapped over the image corner. */
export function DreamStamp({
  label,
  size = "md",
  className,
}: { label: string; size?: BadgeSize } & Positionable) {
  return (
    <span
      className={cx(
        /* 92%, not 72%: the stamp sits over an arbitrary product photo, so its
           backdrop has to be opaque enough that the text contrast stops
           tracking whatever is underneath (worst case 4.75:1 over black). */
        "inline-block -rotate-[8deg] border-2 border-null-txt bg-paper/92 font-semibold tracking-[var(--track-stamp)] whitespace-nowrap text-null-txt uppercase",
        size === "sm"
          ? "px-[7px] py-0.5 text-[9.5px]"
          : "px-2 py-0.5 text-[10px]",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Ledger NULL: a value the owner has not filled in (here: no price). */
export function NullPill({
  label,
  size = "md",
  className,
}: { label: string; size?: BadgeSize } & Positionable) {
  return (
    <span
      className={cx(
        "inline-block border border-null-rule bg-null font-mono whitespace-nowrap text-null-txt italic",
        size === "sm"
          ? "px-1.5 py-0.5 text-[9px]"
          : "px-[9px] py-0.5 text-[11px]",
        className,
      )}
    >
      {label}
    </span>
  );
}

const PRIORITY_TEXT: Record<WishPriority, string> = {
  want: "font-semibold text-null-txt",
  nice: "font-medium text-mute",
  idea: "font-normal text-mute-2",
};

/** Triangle is a pure CSS border trick — no icon, no asset. `idea` has none. */
const PRIORITY_TRIANGLE: Record<WishPriority, string | null> = {
  want: "border-b-[var(--null-txt)]",
  nice: "border-b-[var(--mute-2)]",
  idea: null,
};

export function PriorityFlag({
  priority,
  label,
  size = "md",
  className,
}: { priority: WishPriority; label: string; size?: BadgeSize } & Positionable) {
  const triangle = PRIORITY_TRIANGLE[priority];
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap",
        size === "sm" ? "text-[9px]" : "text-[11px]",
        PRIORITY_TEXT[priority],
        className,
      )}
    >
      {triangle && (
        <span
          aria-hidden
          className={cx(
            "mr-[5px] inline-block h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent",
            triangle,
          )}
        />
      )}
      {label}
    </span>
  );
}

/** 20px chip in the image corner: this wish is not visible to everyone. */
export function VisibilityLockBadge({
  label,
  className,
}: { label: string } & Positionable) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cx(
        /* 92% for the same reason as DreamStamp — it also floats over a photo. */
        "inline-flex h-5 w-5 items-center justify-center border border-rule-2 bg-paper/92 text-mute",
        className,
      )}
    >
      <Lock size={12} strokeWidth={2.4} aria-hidden />
    </span>
  );
}
