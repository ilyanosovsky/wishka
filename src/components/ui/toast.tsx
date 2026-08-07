"use client";

import { useEffect, useRef, type ReactNode } from "react";

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

/** Auto-dismiss that survives inline callbacks: the timer keys off `open`
 *  alone, so a caller re-rendering does not restart the countdown. */
function useAutoDismiss(open: boolean, ms: number, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    timerRef.current = setTimeout(() => dismissRef.current(), ms);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [open, ms]);

  return () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
}

function ToastBar({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2.5 overflow-hidden bg-ink px-3.5 py-1.5 text-paper"
      style={{ animation: "wishka-toast-in var(--dur-slow) var(--ease-out)" }}
    >
      {/* Keyframes live with the component: globals.css is owned elsewhere. */}
      <style href="wishka-toast" precedence="default">
        {"@keyframes wishka-toast-in{from{transform:translateY(100%)}to{transform:translateY(0)}}" +
          "@keyframes wishka-toast-progress{from{transform:scaleX(1)}to{transform:scaleX(0)}}"}
      </style>
      {children}
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
  const cancelTimer = useAutoDismiss(open, UNDO_TOAST_MS, onDismiss);
  if (!open) return null;

  return (
    <ToastBar>
      <span className="flex-1 text-[12.5px]">{message}</span>
      <button
        type="button"
        onClick={() => {
          cancelTimer();
          onAction();
        }}
        className="min-h-11 cursor-pointer px-2 text-[12.5px] font-semibold tracking-[0.02em] text-[var(--toast-accent)]"
      >
        {actionLabel}
      </button>
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-[var(--toast-accent)]"
        style={{
          animation: `wishka-toast-progress ${UNDO_TOAST_MS}ms linear forwards`,
        }}
      />
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
  const cancelTimer = useAutoDismiss(open, INFO_TOAST_MS, onDismiss);
  if (!open) return null;

  return (
    <ToastBar>
      <span className="flex-1 text-[12.5px]">{message}</span>
      {actionLabel && (
        <button
          type="button"
          onClick={() => {
            cancelTimer();
            onAction?.();
          }}
          className="min-h-11 cursor-pointer px-2 text-[12.5px] font-semibold tracking-[0.02em] text-[var(--toast-accent)]"
        >
          {actionLabel}
        </button>
      )}
    </ToastBar>
  );
}
