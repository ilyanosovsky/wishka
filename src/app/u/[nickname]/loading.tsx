import { Skeleton, SkeletonWishCard } from "@/components/ui/skeleton";

/** Skeleton for a public list — same geometry as `public-list.tsx` so nothing
 *  jumps when the data lands (§6.5, mirrors the My List fallback in §6.2). */
export default function Loading() {
  return (
    <main
      aria-busy
      className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pt-14 pb-32 lg:max-w-6xl lg:px-8 lg:pt-8 lg:pb-12"
    >
      <div className="flex items-center gap-3 pb-3 [border-bottom:3px_double_var(--ink)]">
        <Skeleton className="h-10 w-10 flex-none rounded-round" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-2.5 w-24" />
        </div>
        <Skeleton className="h-11 w-11 flex-none" />
      </div>

      <div className="pt-3.5">
        <Skeleton className="h-11 w-48" />
      </div>

      <div className="grid grid-cols-2 gap-3.5 pt-3.5 lg:grid-cols-3 lg:gap-5 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <SkeletonWishCard
            key={index}
            className={index >= 4 ? "hidden lg:flex" : undefined}
          />
        ))}
      </div>
    </main>
  );
}
