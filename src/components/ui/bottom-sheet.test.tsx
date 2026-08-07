import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BottomSheet } from "./bottom-sheet";

describe("BottomSheet", () => {
  it("closes on a scrim tap", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Новое желание">
        <p>Вставь ссылку</p>
      </BottomSheet>,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Новое желание");
    fireEvent.click(screen.getByTestId("bottom-sheet-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose} title="Новое желание" />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("slides out of view and locks the body only while open", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <BottomSheet open onClose={onClose} title="Новое желание" />,
    );
    expect(screen.getByRole("dialog").className).toContain("translate-y-0");
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <BottomSheet open={false} onClose={onClose} title="Новое желание" />,
    );
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.querySelector('[role="dialog"]')?.className).toContain(
      "translate-y-full",
    );
  });
});
