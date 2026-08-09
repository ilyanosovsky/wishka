import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { AudienceOptions } from "@/components/wishes/visibility-sheet";
import { ViewAsSheet } from "./view-as-sheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const CANDIDATES: AudienceOptions = {
  groups: [{ id: "g-1", name: "Семья", emoji: "👨‍👩‍👧", color: "accent" }],
  people: [{ userId: "u-2", name: "Борис", image: null, isPartner: false }],
};

function renderSheet(candidates: AudienceOptions = CANDIDATES) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ViewAsSheet nickname="ilya" candidates={candidates} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Посмотреть, как видят другие" }),
  );
}

describe("ViewAsSheet", () => {
  it("opens the guest preview of the owner's own list", () => {
    renderSheet();

    fireEvent.click(
      screen.getByRole("button", { name: "Открыть предпросмотр" }),
    );

    expect(push).toHaveBeenCalledWith("/u/ilya?as=guest");
  });

  it("opens a group lens once a group is picked", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Участник группы" }));
    fireEvent.click(screen.getByRole("radio", { name: "Семья" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Открыть предпросмотр" }),
    );

    expect(push).toHaveBeenCalledWith("/u/ilya?as=group%3Ag-1");
  });

  it("opens a person lens once a person is picked", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Конкретный человек" }));
    fireEvent.click(screen.getByRole("radio", { name: /Борис/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Открыть предпросмотр" }),
    );

    expect(push).toHaveBeenCalledWith("/u/ilya?as=user%3Au-2");
  });

  it("does not navigate while a picker lens has nothing picked", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Участник группы" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Открыть предпросмотр" }),
    );

    expect(push).not.toHaveBeenCalled();
  });

  it("offers only the guest lens when there is nothing else to look through", () => {
    renderSheet({ groups: [], people: [] });

    expect(screen.getByRole("radio", { name: "Гость" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Участник группы" })).toBeNull();
    expect(
      screen.queryByRole("radio", { name: "Конкретный человек" }),
    ).toBeNull();
  });

  it("states that bookings never show in a preview", () => {
    renderSheet();

    expect(
      screen.getByText("Брони в предпросмотре не показываются никогда"),
    ).toBeInTheDocument();
  });

  it("re-seeds the lens on every open, so a cancelled pick does not linger", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "Участник группы" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Посмотреть, как видят другие" }),
    );

    expect(screen.getByRole("radio", { name: "Гость" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
  it("is one tab stop and moves the lens with the arrow keys (roving radio)", () => {
    renderSheet();

    const guest = screen.getByRole("radio", { name: "Гость" });
    const group = screen.getByRole("radio", { name: "Участник группы" });
    const person = screen.getByRole("radio", { name: "Конкретный человек" });

    expect(guest).toHaveAttribute("tabindex", "0");
    expect(group).toHaveAttribute("tabindex", "-1");
    expect(person).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(guest, { key: "ArrowDown" });
    expect(group).toHaveAttribute("aria-checked", "true");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(guest).toHaveAttribute("tabindex", "-1");

    // Wraps backwards past the first option.
    fireEvent.keyDown(group, { key: "ArrowUp" });
    fireEvent.keyDown(guest, { key: "ArrowLeft" });
    expect(person).toHaveAttribute("aria-checked", "true");
  });
});
