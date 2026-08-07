function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface SkeletonProps {
  className?: string;
}

/** Shimmer block. The `shimmer` keyframes live in globals.css (the one approved exception to
 *  this file's scope — see that file's tail). */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx(
        "animate-[shimmer_1.2s_linear_infinite] bg-gradient-to-r from-zebra via-rule to-zebra bg-[length:180px_100%]",
        className,
      )}
    />
  );
}

/** 4:5 image block + two text lines, matching the wish-card's proportions. */
export function SkeletonWishCard({ className }: SkeletonProps) {
  return (
    <div
      className={cx("flex flex-col border border-rule-2 bg-paper", className)}
    >
      <Skeleton className="aspect-[4/5] w-full" />
      <div className="flex flex-col gap-2 p-2">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  );
}
