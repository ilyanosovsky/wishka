"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const UNDO_TOAST_MS = 5000;
export const INFO_TOAST_MS = 3000;

export type UndoToastProps = {
  open: boolean;
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
};

export type InfoToastProps = {
  open: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
};

type AutoDismiss = {
  /** Stop the countdown for good — the toast is being acted on. */
  cancel: () => void;
  /** Hold the countdown while the bar is hovered or holds focus. */
  pause: () => void;
  /** Resume with whatever time was left when it was paused. */
  resume: () => void;
};

/** Auto-dismiss that survives inline callbacks: the timer keys off `open`
 *  alone, so a caller re-rendering does not restart the countdown. Pausing on
 *  hover/focus is WCAG 2.2.1 — five seconds is not enough to Tab to the undo action
 *  while the countdown runs underneath you, and for the undo toast running out
 *  is what commits the delete. */
function useAutoDismiss(
  open: boolean,
  ms: number,
  onDismiss: () => void,
): AutoDismiss {
  const dismissRef = useRef(onDismiss);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef(ms);
  const startedAtRef = useRef(0);
  const pausedRef = useRef(false);
  /** Set by `cancel()`, cleared only by a fresh `open`. A cancelled countdown
   *  is over for good — `resume()` must not be able to restart it. */
  const cancelledRef = useRef(false);

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(
    (delay: number) => {
      clear();
      remainingRef.current = delay;
      startedAtRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        dismissRef.current();
      }, delay);
    },
    [clear],
  );

  useEffect(() => {
    if (!open) return;
    pausedRef.current = false;
    cancelledRef.current = false;
    start(ms);
    return clear;
  }, [open, ms, start, clear]);

  const cancel = useCallback(() => {
    // `pausedRef` alone was not enough: the pointer leaving the bar after the
    // action button was clicked calls `resume()`, which would `start()` the
    // *full* remaining time again and eventually fire `onDismiss` on a toast
    // the user had already acted on.
    cancelledRef.current = true;
    pausedRef.current = true;
    remainingRef.current = 0;
    clear();
  }, [clear]);

  const pause = useCallback(() => {
    if (cancelledRef.current) return;
    if (pausedRef.current || timerRef.current === null) return;
    pausedRef.current = true;
    remainingRef.current = Math.max(
      0,
      remainingRef.current - (Date.now() - startedAtRef.current),
    );
    clear();
  }, [clear]);

  const resume = useCallback(() => {
    if (cancelledRef.current) return;
    if (!pausedRef.current) return;
    pausedRef.current = false;
    start(remainingRef.current);
  }, [start]);

  return { cancel, pause, resume };
}

function ToastBar({
  children,
  timer,
  progressMs,
}: {
  children: ReactNode;
  timer: Pick<AutoDismiss, "pause" | "resume">;
  /** Draws the draining timer bar; omit for a toast without a countdown cue. */
  progressMs?: number;
}) {
  // Hover and focus are tracked apart: moving the pointer away must not restart
  // the countdown while the Undo button still holds focus. `held` exists only
  // so the drain bar stops with the timer instead of lying about it — it lives
  // here, with the bar, so it is never carried over to the next toast.
  const hovered = useRef(false);
  const focused = useRef(false);
  const [held, setHeld] = useState(false);

  const sync = () => {
    const next = hovered.current || focused.current;
    setHeld(next);
    if (next) timer.pause();
    else timer.resume();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => {
        hovered.current = true;
        sync();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={() => {
        focused.current = false;
        sync();
      }}
      className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2.5 overflow-hidden bg-ink px-3.5 py-1.5 text-paper"
      style={{ animation: "wishka-toast-in var(--dur-slow) var(--ease-out)" }}
    >
      {/* Keyframes live with the component: globals.css is owned elsewhere. */}
      <style href="wishka-toast" precedence="default">
        {"@keyframes wishka-toast-in{from{transform:translateY(100%)}to{transform:translateY(0)}}" +
          "@keyframes wishka-toast-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}
      </style>
      {children}
      {progressMs !== undefined && (
        <span
          aria-hidden
          data-testid="toast-progress"
          className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-[var(--toast-accent)]"
          style={{
            animation: `wishka-toast-progress ${progressMs}ms linear forwards`,
            animationPlayState: held ? "paused" : "running",
          }}
        />
      )}
    </div>
  );
}

/** Destructive-action escape hatch: 5s to change your mind, timer drawn as a
 *  2px bar draining along the bottom edge. */
export function UndoToast({
  open,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: UndoToastProps) {
  const timer = useAutoDismiss(open, UNDO_TOAST_MS, onDismiss);
  if (!open) return null;

  return (
    <ToastBar timer={timer} progressMs={UNDO_TOAST_MS}>
      <span className="flex-1 text-[12.5px]">{message}</span>
      <button
        type="button"
        onClick={() => {
          timer.cancel();
          onAction();
        }}
        className="min-h-11 cursor-pointer px-2 text-[12.5px] font-semibold tracking-[0.02em] text-[var(--toast-accent)]"
      >
        {actionLabel}
      </button>
    </ToastBar>
  );
}

/** Plain confirmation: no timer bar, gone in 3s. */
export function InfoToast({
  open,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: InfoToastProps) {
  const timer = useAutoDismiss(open, INFO_TOAST_MS, onDismiss);
  if (!open) return null;

  return (
    <ToastBar timer={timer}>
      <span className="flex-1 text-[12.5px]">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={() => {
            timer.cancel();
            onAction();
          }}
          className="min-h-11 cursor-pointer px-2 text-[12.5px] font-semibold tracking-[0.02em] text-[var(--toast-accent)]"
        >
          {actionLabel}
        </button>
      )}
    </ToastBar>
  );
}
