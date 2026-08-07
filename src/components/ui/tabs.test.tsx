import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
