function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-10 w-10 text-[14px]",
  lg: "h-16 w-16 text-[22px]",
};

function initialOf(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: AvatarSize;
  alt?: string;
  className?: string;
}

/** Round avatar. Falls back to an ink-tile initial when there's no `src` — no automatic onError
 *  retry, so this stays a plain function component (no client-only state needed). */
export function Avatar({
  src,
  name,
  size = "md",
  alt,
  className,
}: AvatarProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- generic kit component; this repo's image domain allowlist isn't owned here
      <img
        src={src}
        alt={alt ?? name ?? ""}
        className={cx(
          SIZE_CLASS[size],
          "flex-none rounded-round object-cover",
          className,
        )}
      />
    );
  }
  // A nameless initial tile has nothing meaningful to announce (and a literal
  // English fallback would violate invariant #7) — hide it from the a11y tree
  // and let the adjacent visible name carry the information.
  const label = alt ?? name;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cx(
        "flex flex-none items-center justify-center rounded-round bg-ink font-serif text-paper",
        SIZE_CLASS[size],
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}

export interface SquareAvatarProps {
  initial: string;
  size?: AvatarSize;
  className?: string;
}

/** The `.mark` masthead tile — square, ink-filled. Brief specifies serif; note paper-ledger.css's
 *  shipped `.mark` recipe actually uses font-mono — following the brief here (see final report). */
export function SquareAvatar({
  initial,
  size = "md",
  className,
}: SquareAvatarProps) {
  return (
    <span
      className={cx(
        "flex flex-none items-center justify-center bg-ink font-serif font-medium text-paper",
        SIZE_CLASS[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}

export interface AvatarGroupItem {
  src?: string | null;
  name?: string;
}

export interface AvatarGroupProps {
  avatars: AvatarGroupItem[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}

/** Stacked overlap with a bg-colored ring to separate avatars; a "+N" tile absorbs the overflow. */
export function AvatarGroup({
  avatars,
  max = 4,
  size = "sm",
  className,
}: AvatarGroupProps) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - visible.length;
  return (
    <div className={cx("flex items-center", className)}>
      {visible.map((avatar, index) => (
        <Avatar
          key={index}
          src={avatar.src}
          name={avatar.name}
          size={size}
          className={cx("ring-2 ring-bg", index > 0 && "-ml-2")}
        />
      ))}
      {overflow > 0 && (
        <span
          className={cx(
            "-ml-2 flex flex-none items-center justify-center rounded-round bg-zebra font-mono text-[10px] text-mute ring-2 ring-bg",
            SIZE_CLASS[size],
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
