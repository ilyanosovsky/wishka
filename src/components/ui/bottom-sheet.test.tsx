import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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
    expect(screen.getByRole("dialog")).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("dialog").className).toContain(
      "bottom-sheet-panel",
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
    expect(document.querySelector('[role="dialog"]')).toHaveAttribute(
      "data-open",
      "false",
    );
  });
});

describe("BottomSheet focus management", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Open sheet
        </button>
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title="Who can see"
          footer={
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          }
        >
          <button type="button">Everyone</button>
        </BottomSheet>
      </div>
    );
  }

  function openSheet() {
    const trigger = screen.getByRole("button", { name: "Open sheet" });
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
  }

  it("moves focus into the sheet and inerts the page behind", () => {
    render(<Harness />);
    const trigger = openSheet();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Everyone" }),
    );
    expect(trigger).toHaveAttribute("inert");
  });

  it("cycles Tab inside the sheet", () => {
    render(<Harness />);
    openSheet();

    const first = screen.getByRole("button", { name: "Everyone" });
    const last = screen.getByRole("button", { name: "Done" });

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("returns focus to the trigger on close and releases the page", () => {
    render(<Harness />);
    const trigger = openSheet();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
    expect(trigger).not.toHaveAttribute("inert");
  });
});
