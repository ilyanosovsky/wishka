import { Skeleton, SkeletonWishCard } from "@/components/ui/skeleton";

/** Skeleton for My List: the masthead block plus a card grid, in the same
 *  geometry as `my-list.tsx` so nothing shifts when data lands. Scoped to the
 *  `(list)` group — at `src/app/` it would be the fallback for every route. */
export default function Loading() {
  return (
    <main
      aria-busy
      className="mx-auto flex min-h-dvh max-w-105 flex-col px-5 pt-14 pb-32"
    >
      <div className="flex items-center gap-3 pb-3 [border-bottom:3px_double_var(--ink)]">
        <Skeleton className="h-10 w-10 flex-none" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-2.5 w-40" />
        </div>
        <div className="flex flex-none gap-1.5">
          <Skeleton className="h-11 w-11" />
          <Skeleton className="h-11 w-11" />
          <Skeleton className="h-11 w-11" />
        </div>
      </div>

      <div className="flex flex-col gap-2.5 pt-3">
        <div className="flex gap-1.5">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-11 flex-1" />
          <Skeleton className="h-11 w-40" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5 pt-3.5">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonWishCard key={index} />
        ))}
      </div>
    </main>
  );
}
