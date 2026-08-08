function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The square tile that stands for a group everywhere it is listed (§6.7).
 *
 * `color` is an opaque key from `GROUP_COLORS`; the token pairs live here
 * because the data layer stores a key, not a palette. An unknown key falls back
 * to the neutral tile instead of rendering nothing — a group is never invisible
 * because its colour drifted out of the allow-list.
 */
const SWATCH_CLASS: Record<string, string> = {
  ink: "border-ink bg-ink text-paper",
  accent: "border-accent bg-accent text-paper",
  null: "border-null-rule bg-null text-null-txt",
  zebra: "border-rule-2 bg-zebra text-ink",
  /* text-ink, not text-mute: --mute on --rule is 3.39:1, and the initial is
     17–21px serif — real text, AA or nothing. */
  rule: "border-rule bg-rule text-ink",
  mute: "border-mute bg-mute text-paper",
};

const NEUTRAL_CLASS = "border-rule-2 bg-paper text-ink";

export function groupSwatchClass(color: string | null | undefined): string {
  return (color && SWATCH_CLASS[color]) || NEUTRAL_CLASS;
}

/** By code point, not code unit: a name starting with an astral character
 *  (an emoji, say) would otherwise render half a surrogate pair. */
function initialOf(name: string): string {
  const [first] = [...name.trim()];
  return first ? first.toUpperCase() : "?";
}

export type GroupMarkSize = "md" | "lg";

const SIZE_CLASS: Record<GroupMarkSize, string> = {
  md: "h-10 w-10 text-[17px]",
  lg: "h-12 w-12 text-[21px]",
};

export type GroupMarkProps = {
  name: string;
  emoji: string | null;
  color: string | null;
  size?: GroupMarkSize;
  className?: string;
};

/** Square by house rule — only avatars are round. Decorative: the group name is
 *  always spelled out next to it, so the tile carries no accessible name. */
export function GroupMark({
  name,
  emoji,
  color,
  size = "md",
  className,
}: GroupMarkProps) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex flex-none items-center justify-center border font-serif font-medium",
        SIZE_CLASS[size],
        groupSwatchClass(color),
        className,
      )}
    >
      {emoji ?? initialOf(name)}
    </span>
  );
}
