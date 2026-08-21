import { cleanup, render, screen } from "@testing-library/react";
import { Gift, List, User } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TabBar } from "./tab-bar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/people",
}));

afterEach(cleanup);

const items = [
  { key: "list", label: "My list", icon: List, href: "/" },
  { key: "people", label: "People", icon: Gift, href: "/people" },
  { key: "profile", label: "Profile", icon: User, href: "/profile" },
];

describe("TabBar responsive shell", () => {
  it("marks the branded navigation as the desktop app rail", () => {
    render(
      <TabBar
        ariaLabel="Main navigation"
        desktopBrand="Wishka"
        items={items}
      />,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Main navigation",
    });
    expect(navigation).toHaveAttribute("data-app-navigation", "true");
    expect(navigation.className).toContain("lg:flex-col");
    expect(screen.getByRole("link", { name: "Wishka" })).toHaveClass(
      "hidden",
      "lg:block",
    );
  });

  it("keeps route state and generic uses independent from the app shell", () => {
    const { rerender } = render(<TabBar items={items} />);

    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("navigation")).not.toHaveAttribute(
      "data-app-navigation",
    );

    rerender(<TabBar desktopBrand="Wishka" items={items} />);
    expect(screen.getByRole("navigation")).toHaveAttribute(
      "data-app-navigation",
      "true",
    );
  });
});
