import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { ViewAsBanner, type ViewAsLens } from "./view-as-banner";

afterEach(cleanup);

function renderBanner(lens: ViewAsLens) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ViewAsBanner lens={lens} />
    </NextIntlClientProvider>,
  );
}

describe("ViewAsBanner", () => {
  // /u/<nickname> is still a preview for its owner, only without this banner —
  // leaving has to land somewhere that is not one.
  it("names the guest lens and exits to the profile, not back into a preview", () => {
    renderBanner({ kind: "guest" });

    expect(screen.getByText("Предпросмотр: глазами гостя")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Выйти" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });

  it("names the group and the person lenses", () => {
    renderBanner({ kind: "group", name: "Семья" });
    expect(
      screen.getByText("Предпросмотр: участник «Семья»"),
    ).toBeInTheDocument();

    cleanup();
    renderBanner({ kind: "person", name: "Борис" });
    expect(screen.getByText("Предпросмотр: Борис")).toBeInTheDocument();
  });

  it("always states that bookings are hidden in a preview", () => {
    renderBanner({ kind: "guest" });

    expect(
      screen.getByText("Брони в предпросмотре не показываются никогда"),
    ).toBeInTheDocument();
  });
});
