import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "./dialog";
import { InfoToast, UndoToast } from "./toast";

describe("Dialog", () => {
  it("fires the action callbacks", () => {
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    render(
      <Dialog
        open
        title="Удалить желание?"
        description="«Керамическая ваза» исчезнет из списка."
        onClose={onCancel}
        actions={[
          { label: "Отмена", onClick: onCancel, tone: "neutral" },
          { label: "Удалить", onClick: onDelete, tone: "destructive" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("puts the destructive action on the right whatever the input order", () => {
    render(
      <Dialog
        open
        title="Удалить желание?"
        onClose={vi.fn()}
        actions={[
          { label: "Удалить", onClick: vi.fn(), tone: "destructive" },
          { label: "Отмена", onClick: vi.fn(), tone: "neutral" },
        ]}
      />,
    );

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual(["Отмена", "Удалить"]);
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
        actionLabel="Открыть"
        onAction={onAction}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Желание добавлено")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(3000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
