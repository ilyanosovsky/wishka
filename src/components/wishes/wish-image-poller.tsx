"use client";

import { useEffect, useRef } from "react";
import { getWishImageStateAction } from "@/app/wishes/ai-actions";

/**
 * Headless poller for wishes whose card image is generating async (Phase 6
 * §6.2 — the `after()` job that writes `wishes.imageStatus`). Renders
 * nothing; polls `getWishImageStateAction` for every id in `wishIds` until it
 * turns terminal (`ready`/`failed`) or ~3 minutes pass, whichever comes
 * first — the belt-and-braces half of "Stuck generating" in the Phase 6
 * contract (the job itself always lands a terminal status via try/catch;
 * this is only for the rare case it never does).
 *
 * Callers own what "settled" means: my-list.tsx toasts on `ready` and always
 * refreshes; wish-detail.tsx does the same for its one wish. Neither state
 * lives here — this component is a plain interval, no local UI of its own.
 */

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

export type WishImagePollerProps = {
  /** Wish ids currently in `generating` — polling starts/stops as this list
   *  changes; an empty array polls nothing. */
  wishIds: string[];
  /** Fired once per wish id the moment it reaches a terminal image status. */
  onSettled: (wishId: string, status: "ready" | "failed") => void;
  /** Poll cadence — overridable for tests. */
  intervalMs?: number;
  /** Per-id give-up window — overridable for tests. */
  timeoutMs?: number;
};

export function WishImagePoller({
  wishIds,
  onSettled,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: WishImagePollerProps) {
  // Always call the latest callback without making it an effect dependency
  // (the caller typically passes a fresh closure every render).
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  // Ids already reported to the caller in the current polling run, and when
  // each one started — both keyed by wish id so a card that re-enters
  // `wishIds` later (a second retry) gets its own fresh timeout window.
  const settledRef = useRef(new Set<string>());
  const startedAtRef = useRef(new Map<string, number>());

  // Effects key off primitives, not array identity — `wishIds` is typically a
  // fresh array every render even when its contents haven't changed.
  const key = wishIds.join(",");

  useEffect(() => {
    if (wishIds.length === 0) return;

    const now = Date.now();
    const idSet = new Set(wishIds);
    // Prune ids no longer present on every effect run — otherwise a wish
    // that leaves `wishIds` and later re-enters (a second retry) inherits its
    // stale start time and reads as already-timed-out the instant it comes
    // back, even though it never got a second polling window.
    for (const id of startedAtRef.current.keys()) {
      if (!idSet.has(id)) startedAtRef.current.delete(id);
    }
    for (const id of wishIds) {
      if (!startedAtRef.current.has(id)) startedAtRef.current.set(id, now);
      settledRef.current.delete(id);
    }

    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        for (const id of wishIds) {
          if (cancelled || settledRef.current.has(id)) continue;

          const startedAt = startedAtRef.current.get(id) ?? now;
          if (Date.now() - startedAt >= timeoutMs) {
            // Give up — leave the card on whatever the row already says.
            settledRef.current.add(id);
            startedAtRef.current.delete(id);
            continue;
          }

          let state: Awaited<ReturnType<typeof getWishImageStateAction>>;
          try {
            state = await getWishImageStateAction(id);
          } catch {
            continue; // transient — retry next tick
          }
          if (cancelled) return;

          if (
            state &&
            (state.imageStatus === "ready" || state.imageStatus === "failed")
          ) {
            settledRef.current.add(id);
            startedAtRef.current.delete(id);
            onSettledRef.current(id, state.imageStatus);
          }
        }
      })();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // `key` stands in for `wishIds` (see above); `onSettled` is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intervalMs, timeoutMs]);

  return null;
}
