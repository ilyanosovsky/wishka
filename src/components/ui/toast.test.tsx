import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { INFO_TOAST_MS, InfoToast, UNDO_TOAST_MS, UndoToast } from "./toast";

/**
 * The auto-dismiss timer is the whole contract here: for the undo toast,
 * running out is what *commits* a delete, so pausing (WCAG 2.2.1) and, above
 * all, cancelling have to be exact.
 */

afterEach(cleanup);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderUndo(overrides?: {
  onAction?: () => void;
  onDismiss?: () => void;
}) {
  const onAction = overrides?.onAction ?? vi.fn();
  const onDismiss = overrides?.onDismiss ?? vi.fn();
  render(
    <UndoToast
      open
      message="Желание удалено"
      actionLabel="Отменить"
      onAction={onAction}
      onDismiss={onDismiss}
    />,
  );
  return { onAction, onDismiss, bar: screen.getByRole("status") };
}

describe("UndoToast — countdown", () => {
  it("dismisses itself once the window runs out", async () => {
    const { onDismiss } = renderUndo();
    await vi.advanceTimersByTimeAsync(UNDO_TOAST_MS + 10);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("holds the countdown while the bar is hovered", async () => {
    const { onDismiss, bar } = renderUndo();

    await vi.advanceTimersByTimeAsync(1000);
    fireEvent.mouseEnter(bar);
    await vi.advanceTimersByTimeAsync(UNDO_TOAST_MS * 2);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(bar);
    await vi.advanceTimersByTimeAsync(UNDO_TOAST_MS);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("UndoToast — cancel is final", () => {
  it("stops the countdown when the action is taken", async () => {
    const { onAction, onDismiss } = renderUndo();

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UNDO_TOAST_MS * 3);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  /**
   * The regression: `cancel()` used to set only `pausedRef`, so the very next
   * `resume()` — the pointer leaving the bar right after the click — restarted
   * the *full* countdown and eventually fired `onDismiss` on a toast the user
   * had already acted on.
   */
  it("cannot be resumed by the pointer leaving the bar afterwards", async () => {
    const { onDismiss, bar } = renderUndo();

    fireEvent.mouseEnter(bar);
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    fireEvent.mouseLeave(bar);

    await vi.advanceTimersByTimeAsync(UNDO_TOAST_MS * 3);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("cannot be resumed by focus leaving the action button", async () => {
    const { onDismiss, bar } = renderUndo();
    const undo = screen.getByRole("button", { name: "Отменить" });

    fireEvent.focus(bar);
    fireEvent.click(undo);
    fireEvent.blur(bar);

    await vi.advanceTimersByTimeAsync(UNDO_TOAST_MS * 3);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("InfoToast", () => {
  it("dismisses itself after the short window", async () => {
    const onDismiss = vi.fn();
    render(
      <InfoToast open message="Ссылка скопирована" onDismiss={onDismiss} />,
    );

    await vi.advanceTimersByTimeAsync(INFO_TOAST_MS - 100);
    expect(onDismiss).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<InfoToast open={false} message="Скрыто" onDismiss={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps its optional action's cancel final too", async () => {
    const onDismiss = vi.fn();
    render(
      <InfoToast
        open
        message="Готово"
        actionLabel="Открыть"
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    const bar = screen.getByRole("status");

    fireEvent.mouseEnter(bar);
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    fireEvent.mouseLeave(bar);

    await vi.advanceTimersByTimeAsync(INFO_TOAST_MS * 3);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
