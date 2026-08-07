"use client";

import { useEffect, useId, type ReactNode } from "react";

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  footer?: ReactNode;
};

/**
 * Paper Ledger bottom sheet. Stays mounted so the translate-y transition can
 * play in both directions; square corners even here — the radius rule has no
 * exceptions outside avatars.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: BottomSheetProps) {
  const titleId = useId();

  // The sheet owns the viewport while it is up.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
    >
      <div
        data-testid="bottom-sheet-scrim"
        aria-hidden
        onClick={onClose}
        className={`absolute inset-0 bg-[var(--scrim)] transition-opacity duration-[var(--dur-base)] ease-[var(--ease-out)] ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`absolute inset-x-0 bottom-0 border-t border-rule-2 bg-paper shadow-[var(--shadow-bottom-sheet)] transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex justify-center pt-2 pb-0.5">
          <span aria-hidden className="h-[3px] w-9 bg-rule-2" />
        </div>
        {title && (
          <div
            id={titleId}
            className="px-[18px] pt-2 pb-1 font-serif text-[17px] font-semibold"
          >
            {title}
          </div>
        )}
        <div className={`px-[18px] pt-2.5 ${footer ? "" : "pb-[18px]"}`}>
          {children}
        </div>
        {footer && (
          <div className="flex gap-2 px-[18px] pt-3 pb-[18px]">{footer}</div>
        )}
      </div>
    </div>
  );
}
