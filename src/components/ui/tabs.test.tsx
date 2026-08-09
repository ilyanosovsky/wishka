import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Tabs, type TabItem } from "./tabs";

// This repo's vitest config doesn't set `globals: true`, so RTL's automatic
// afterEach-cleanup detection never fires — clean up explicitly per test.
afterEach(cleanup);

const items: TabItem[] = [
  { value: "all", label: "All", count: 7 },
  { value: "dreams", label: "Dreams" },
];

describe("Tabs", () => {
  it("calls onChange with the clicked tab's value", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="all" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: /Dreams/ }));

    expect(onChange).toHaveBeenCalledWith("dreams");
  });

  it("marks the active tab as selected and applies the ink fill by default", () => {
    render(<Tabs items={items} value="all" onChange={() => {}} />);

    const activeTab = screen.getByRole("tab", { name: /All/ });
    const inactiveTab = screen.getByRole("tab", { name: "Dreams" });

    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(activeTab.className).toContain("bg-ink");
    expect(inactiveTab).toHaveAttribute("aria-selected", "false");
  });

  it("applies the accent fill when fill='accent'", () => {
    render(
      <Tabs items={items} value="dreams" onChange={() => {}} fill="accent" />,
    );

    const activeTab = screen.getByRole("tab", { name: "Dreams" });

    expect(activeTab.className).toContain("bg-accent");
  });

  it("re-renders the active tab when the controlled value prop changes", () => {
    const { rerender } = render(
      <Tabs items={items} value="all" onChange={() => {}} />,
    );
    rerender(<Tabs items={items} value="dreams" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "Dreams" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

describe("Tabs keyboard pattern", () => {
  it("keeps one tab stop: the active tab is 0, the rest -1", () => {
    render(<Tabs items={items} value="all" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Dreams" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("moves the selection with Arrow keys and wraps", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="all" onChange={onChange} />);
    const tablist = screen.getByRole("tablist");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("dreams");

    // The value prop is controlled, so from "all" ArrowLeft wraps to the end.
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("dreams");
  });

  it("jumps to the ends with Home and End", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="dreams" onChange={onChange} />);
    const tablist = screen.getByRole("tablist");

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("all");

    fireEvent.keyDown(tablist, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("dreams");
  });

  it("focuses the tab it moved to", () => {
    function Controlled() {
      const [value, setValue] = useState("all");
      return <Tabs items={items} value={value} onChange={setValue} />;
    }
    render(<Controlled />);

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });

    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Dreams" }),
    );
  });

  it("ignores keys it does not own", () => {
    const onChange = vi.fn();
    render(<Tabs items={items} value="all" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("tablist"), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
