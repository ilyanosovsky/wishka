"use client";

import { useEffect, useId, useRef } from "react";

import { useModalFocus } from "./use-modal-focus";

export type DialogTone = "neutral" | "accent" | "destructive";

export type DialogAction = {
  label: string;
  onClick: () => void;
  tone: DialogTone;
};

export type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  /** One or two actions — the footer is a two-column split, never more. */
  actions: readonly [DialogAction] | readonly [DialogAction, DialogAction];
  onClose: () => void;
};

/** House rule: the confirming — and above all the destructive — action is right. */
const TONE_ORDER: Record<DialogTone, number> = {
  neutral: 0,
  accent: 1,
  destructive: 2,
};

function toneClass(tone: DialogTone, hasDestructive: boolean): string {
  if (tone === "destructive") return "font-semibold text-neg";
  if (tone === "accent") return "font-semibold text-accent";
  // A neutral dismiss reads muted next to a positive confirm, plain ink next
  // to a destructive one — it has to hold its own against the red.
  return hasDestructive ? "font-medium text-ink" : "font-medium text-mute";
}

/** Centered confirm dialog on a 40%-ink scrim. */
export function Dialog({
  open,
  title,
  description,
  actions,
  onClose,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useModalFocus({ open, panelRef, rootRef });

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

  if (!open) return null;

  const ordered = [...actions].sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone],
  );
  const hasDestructive = ordered.some(
    (action) => action.tone === "destructive",
  );

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
    >
      <div
        data-testid="dialog-scrim"
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        /* -1: the panel itself takes focus on open when it has no focusable
           child, and stays out of the tab sequence otherwise. */
        tabIndex={-1}
        className="relative w-[300px] max-w-full border border-rule-2 bg-paper shadow-[var(--shadow-dialog)]"
      >
        <div
          id={titleId}
          className="px-[18px] pt-4 pb-1 font-serif text-[17px] font-semibold"
        >
          {title}
        </div>
        {description && (
          <div
            id={descriptionId}
            className="px-[18px] pt-1 pb-3.5 text-[12.5px] leading-[1.5] text-mute"
          >
            {description}
          </div>
        )}
        <div className="flex border-t border-rule">
          {ordered.map((action, index) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className={`min-h-11 flex-1 cursor-pointer px-3 py-3 text-center text-[13px] ${
                index < ordered.length - 1 ? "border-r border-rule" : ""
              } ${toneClass(action.tone, hasDestructive)}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
