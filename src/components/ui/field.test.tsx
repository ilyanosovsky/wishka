import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextField, TextareaField } from "./field";

describe("TextField error state", () => {
  it("keeps the focus treatment when the field is in error", () => {
    render(<TextField label="Название" error helperText="Заполни поле" />);

    const input = screen.getByLabelText("Название");
    // border-neg only repaints the resting border; losing the focus pair here
    // would leave a keyboard user with no indicator on the one field they were
    // sent back to (WCAG 2.4.7).
    expect(input.className).toContain("border-neg");
    expect(input.className).toContain("focus:border-accent");
    expect(input.className).toContain(
      "focus:shadow-[inset_0_0_0_1px_var(--accent)]",
    );
  });

  it("announces the error and points at the helper text", () => {
    render(<TextField label="Название" error helperText="Заполни поле" />);

    const input = screen.getByLabelText("Название");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Заполни поле");
  });

  it("says nothing when the field is fine", () => {
    render(<TextField label="Название" helperText="Заполни поле" />);

    const input = screen.getByLabelText("Название");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("Заполни поле")).toBeNull();
  });

  it("keeps a caller-supplied description alongside the helper text", () => {
    render(
      <>
        <span id="hint">Как в магазине</span>
        <TextField
          label="Название"
          error
          helperText="Заполни поле"
          aria-describedby="hint"
        />
      </>,
    );

    expect(screen.getByLabelText("Название")).toHaveAccessibleDescription(
      "Как в магазине Заполни поле",
    );
  });
});

describe("TextareaField error state", () => {
  it("carries the same focus classes, aria-invalid and description", () => {
    render(<TextareaField label="Заметка" error helperText="Слишком длинно" />);

    const textarea = screen.getByLabelText("Заметка");
    expect(textarea.className).toContain("border-neg");
    expect(textarea.className).toContain("focus:border-accent");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAccessibleDescription("Слишком длинно");
  });
});
