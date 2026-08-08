import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog } from "./dialog";
import { InfoToast, UndoToast } from "./toast";

describe("Dialog", () => {
  it("fires the action callbacks", () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    render(
      <Dialog
        open
        title="Delete this wish?"
        description='"Ceramic vase" will disappear from the list.'
        onClose={onCancel}
        actions={[
          { label: "Cancel", onClick: onCancel, tone: "neutral" },
          { label: "Delete", onClick: onDelete, tone: "destructive" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("puts the destructive action on the right whatever the input order", () => {
    render(
      <Dialog
        open
        title="Delete this wish?"
        onClose={vi.fn()}
        actions={[
          { label: "Delete", onClick: vi.fn(), tone: "destructive" },
          { label: "Cancel", onClick: vi.fn(), tone: "neutral" },
        ]}
      />,
    );

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual(["Cancel", "Delete"]);
  });

  it("closes on a scrim tap and renders nothing when closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog
        open
        title="Сохранить черновик?"
        onClose={onClose}
        actions={[{ label: "Сохранить", onClick: vi.fn(), tone: "accent" }]}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Dialog
        open={false}
        title="Сохранить черновик?"
        onClose={onClose}
        actions={[{ label: "Сохранить", onClick: vi.fn(), tone: "accent" }]}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("UndoToast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses after 5s", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        open
        message="Бронь снята"
        actionLabel="Отменить"
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    act(() => void vi.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("cancels the timer when the action is used", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        open
        message="Бронь снята"
        actionLabel="Отменить"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    act(() => void vi.advanceTimersByTime(10000));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("holds the countdown while the bar is hovered, then finishes it", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        open
        message="Бронь снята"
        actionLabel="Отменить"
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    const bar = screen.getByRole("status");
    act(() => void vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(bar);

    // Hovering is the user reading the toast — 5s of it must not run out.
    act(() => void vi.advanceTimersByTime(10000));
    expect(onDismiss).not.toHaveBeenCalled();
    // The drain bar is the timer made visible; it has to stop with it.
    expect(screen.getByTestId("toast-progress")).toHaveStyle({
      animationPlayState: "paused",
    });

    fireEvent.mouseLeave(bar);
    act(() => void vi.advanceTimersByTime(2999));
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("holds the countdown while the Undo button has focus", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        open
        message="Бронь снята"
        actionLabel="Отменить"
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    const undo = screen.getByRole("button", { name: "Отменить" });
    fireEvent.focusIn(undo);
    act(() => void vi.advanceTimersByTime(10000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.focusOut(undo);
    act(() => void vi.advanceTimersByTime(5000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while closed", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <UndoToast
        open={false}
        message="Бронь снята"
        actionLabel="Отменить"
        onAction={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    act(() => void vi.advanceTimersByTime(10000));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByText("Бронь снята")).toBeNull();
  });
});

describe("InfoToast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses after 3s and renders an optional action", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <InfoToast
        open
        message="Желание добавлено"
        actionLabel="Open dialog"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Желание добавлено")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog focus management", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <p>Page behind the dialog</p>
        <Dialog
          open={open}
          title="Delete this wish?"
          onClose={() => setOpen(false)}
          actions={[
            { label: "Cancel", onClick: () => setOpen(false), tone: "neutral" },
            {
              label: "Delete",
              onClick: () => setOpen(false),
              tone: "destructive",
            },
          ]}
        />
      </div>
    );
  }

  function openDialog() {
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
  }

  it("moves focus into the panel on open", () => {
    render(<Harness />);
    openDialog();

    const panel = screen.getByRole("dialog");
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
  });

  it("makes the page behind inert while open", () => {
    render(<Harness />);
    const trigger = openDialog();

    expect(trigger).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).not.toHaveAttribute("inert");
  });

  it("cycles Tab inside the panel in both directions", () => {
    render(<Harness />);
    openDialog();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const remove = screen.getByRole("button", { name: "Delete" });

    remove.focus();
    fireEvent.keyDown(remove, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(remove);
  });

  it("returns focus to whatever opened it", () => {
    render(<Harness />);
    const trigger = openDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Dialog error region", () => {
  it("renders a passed error as a role=alert line", () => {
    render(
      <Dialog
        open
        title="Delete this wish?"
        error="Something went wrong — try again"
        onClose={() => {}}
        actions={[{ label: "Cancel", onClick: () => {}, tone: "neutral" }]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong — try again",
    );
  });

  it("renders no alert region without an error", () => {
    render(
      <Dialog
        open
        title="Delete this wish?"
        onClose={() => {}}
        actions={[{ label: "Cancel", onClick: () => {}, tone: "neutral" }]}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
