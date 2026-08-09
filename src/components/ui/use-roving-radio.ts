"use client";

import { useRef, type KeyboardEvent } from "react";

/** How the hook finds its items when a call site does not register refs. */
const DEFAULT_ITEM_SELECTOR = '[role="radio"],[role="tab"]';

export type RovingRadio<T extends string> = {
  /** Attach to the group container — it reads `currentTarget` to find items. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** 0 for the selected item, -1 for the rest: one tab stop per group. */
  tabIndex: (item: T) => 0 | -1;
  /**
   * Optional ref callback per item. Register the items when they are not plain
   * children of the group container (a sub-list, a wrapper row); otherwise the
   * selector fallback finds them and this can be skipped.
   */
  itemRef: (item: T) => (node: HTMLElement | null) => void;
};

/**
 * Roving tabindex + arrow keys for a `role="radiogroup"` (or any single-select
 * strip of buttons — `Tabs` uses it for its `role="tablist"`). The group is one
 * tab stop and Arrow keys move the selection: what AT announces as "radio
 * button, 1 of 3" has to behave like one.
 *
 * ```tsx
 * const roving = useRovingRadio({ values: MODES, value: mode, onChange: setMode });
 *
 * <div role="radiogroup" aria-label={t("mode")} onKeyDown={roving.onKeyDown}>
 *   {MODES.map((m) => (
 *     <button key={m} role="radio" aria-checked={m === mode}
 *             ref={roving.itemRef(m)} tabIndex={roving.tabIndex(m)}
 *             onClick={() => setMode(m)}>
 *       {label(m)}
 *     </button>
 *   ))}
 * </div>
 * ```
 *
 * ArrowRight/ArrowDown step forward, ArrowLeft/ArrowUp back (both wrap),
 * Home/End jump to the ends. Selection follows focus — the expected radio-group
 * behaviour, and it keeps `onChange` the single source of truth.
 *
 * Items that skip `itemRef` must be in the same order as `values` and match
 * `itemSelector` (default: `[role="radio"]` / `[role="tab"]`).
 */
export function useRovingRadio<T extends string>({
  values,
  value,
  onChange,
  itemSelector = DEFAULT_ITEM_SELECTOR,
}: {
  values: readonly T[];
  value: T | null;
  onChange: (next: T) => void;
  itemSelector?: string;
}): RovingRadio<T> {
  const nodes = useRef(new Map<T, HTMLElement>());

  const index = value === null ? -1 : values.indexOf(value);
  const current = index === -1 ? 0 : index;

  function focusItem(group: HTMLElement, at: number) {
    const registered = nodes.current.get(values[at]);
    if (registered) {
      registered.focus();
      return;
    }
    group.querySelectorAll<HTMLElement>(itemSelector)[at]?.focus();
  }

  function move(group: HTMLElement, next: number) {
    onChange(values[next]);
    focusItem(group, next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (values.length === 0) return;
    const group = event.currentTarget;
    const last = values.length - 1;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(group, current === last ? 0 : current + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(group, current === 0 ? last : current - 1);
        break;
      case "Home":
        event.preventDefault();
        move(group, 0);
        break;
      case "End":
        event.preventDefault();
        move(group, last);
        break;
      default:
        break;
    }
  }

  function itemRef(item: T) {
    return (node: HTMLElement | null) => {
      if (node) nodes.current.set(item, node);
      else nodes.current.delete(item);
    };
  }

  // Nothing selected (or a value from outside the group): the first item holds
  // the tab stop, so the group never drops out of the tab sequence entirely.
  const active = values[current];

  return {
    onKeyDown,
    tabIndex: (item: T) => (item === active ? 0 : -1),
    itemRef,
  };
}
