"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("inert") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[inert]"),
  );
}

/**
 * Marks everything outside `root` as `inert`, so the page behind an open modal
 * is neither tabbable, clickable, nor in the accessibility tree. Walks up from
 * `root` to <body> inerting each sibling on the way; returns the undo. Siblings
 * that were already inert (a closed BottomSheet, say) are left alone so the
 * undo cannot un-hide them.
 *
 * `inert` alone, not `inert` + `aria-hidden`: the attribute already removes the
 * subtree from the a11y tree in every browser that ships it, and doubling up
 * would make `aria-hidden` the thing that has to be unwound correctly on every
 * exit path.
 */
function hideOutside(root: HTMLElement): () => void {
  const hidden: HTMLElement[] = [];
  let node: HTMLElement | null = root;

  while (node && node.parentElement) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      hidden.push(sibling);
    }
    node = parent === document.body ? null : parent;
  }

  return () => {
    for (const element of hidden) element.removeAttribute("inert");
  };
}

export type ModalFocusOptions = {
  open: boolean;
  /** The dialog panel: focus moves inside it and Tab cycles within it. */
  panelRef: RefObject<HTMLElement | null>;
  /**
   * The whole overlay (panel + scrim). Everything *outside* this element is
   * made inert while the modal is open — passing the panel alone would kill the
   * scrim's tap-to-close.
   */
  rootRef: RefObject<HTMLElement | null>;
};

/**
 * The four things `role="dialog" aria-modal="true"` promises and the browser
 * does not deliver: focus moves into the panel on open, Tab cycles inside it,
 * the rest of the page goes inert, and focus returns to whatever opened the
 * modal on close. Escape and the scrim stay the caller's business.
 *
 * The panel needs `tabIndex={-1}` so it can hold focus when it contains no
 * focusable child.
 */
export function useModalFocus({ open, panelRef, rootRef }: ModalFocusOptions) {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const root = rootRef.current ?? panel;
    if (!panel || !root) return;

    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const restoreOutside = hideOutside(root);
    (focusableWithin(panel)[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (!active || !panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreOutside();
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, panelRef, rootRef]);
}
