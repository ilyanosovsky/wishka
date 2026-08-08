import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRovingRadio } from "./use-roving-radio";

const MODES = ["everyone", "groups", "people"] as const;
type Mode = (typeof MODES)[number];

const LABEL: Record<Mode, string> = {
  everyone: "Всем",
  groups: "Группам",
  people: "Людям",
};

function Group({ initial = "everyone" as Mode }: { initial?: Mode }) {
  const [value, setValue] = useState<Mode>(initial);
  const roving = useRovingRadio({ values: MODES, value, onChange: setValue });
  return (
    <div role="radiogroup" aria-label="Кому видно" onKeyDown={roving.onKeyDown}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={mode === value}
          tabIndex={roving.tabIndex(mode)}
          onClick={() => setValue(mode)}
        >
          {LABEL[mode]}
        </button>
      ))}
    </div>
  );
}

function radio(mode: Mode) {
  return screen.getByRole("radio", { name: LABEL[mode] });
}

describe("useRovingRadio", () => {
  it("gives the group a single tab stop", () => {
    render(<Group initial="groups" />);

    expect(radio("everyone")).toHaveAttribute("tabindex", "-1");
    expect(radio("groups")).toHaveAttribute("tabindex", "0");
    expect(radio("people")).toHaveAttribute("tabindex", "-1");
  });

  it("moves the selection and the focus with Arrow keys, wrapping both ways", () => {
    render(<Group />);
    const group = screen.getByRole("radiogroup");

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(radio("groups")).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(radio("groups"));

    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(radio("people")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(radio("everyone")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(radio("people")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(radio("groups")).toHaveAttribute("aria-checked", "true");
  });

  it("jumps to the ends with Home and End", () => {
    render(<Group initial="groups" />);
    const group = screen.getByRole("radiogroup");

    fireEvent.keyDown(group, { key: "End" });
    expect(radio("people")).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(group, { key: "Home" });
    expect(radio("everyone")).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the group reachable when nothing is selected", () => {
    function Empty() {
      const roving = useRovingRadio<Mode>({
        values: MODES,
        value: null,
        onChange: () => {},
      });
      return (
        <div role="radiogroup" aria-label="Пусто" onKeyDown={roving.onKeyDown}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={false}
              tabIndex={roving.tabIndex(mode)}
            >
              {LABEL[mode]}
            </button>
          ))}
        </div>
      );
    }
    render(<Empty />);

    expect(radio("everyone")).toHaveAttribute("tabindex", "0");
    expect(radio("groups")).toHaveAttribute("tabindex", "-1");
  });
});
