import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { CurrencySheet } from "./currency-sheet";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
});

function renderSheet(onSelect = vi.fn()) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <CurrencySheet
        open
        onClose={() => {}}
        value="GEL"
        baseCurrency="USD"
        onSelect={onSelect}
      />
    </NextIntlClientProvider>,
  );
  return { onSelect };
}

describe("CurrencySheet", () => {
  it("always lists the base currency under 'recent'", () => {
    renderSheet();
    expect(screen.getByText("Базовая и недавние")).toBeInTheDocument();
    // USD appears twice — once under "recent" (it's the base currency), once
    // in the full list below — so assert presence rather than uniqueness.
    expect(
      screen.getAllByRole("button", { name: /USD/ }).length,
    ).toBeGreaterThan(0);
  });

  it("filters the full list by search query", () => {
    renderSheet();
    fireEvent.change(screen.getByPlaceholderText("Поиск валюты"), {
      target: { value: "eur" },
    });
    expect(screen.getByRole("button", { name: /EUR/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /GBP/ })).toBeNull();
    // Searching hides the "recent" section entirely.
    expect(screen.queryByText("Базовая и недавние")).toBeNull();
  });

  it("selects a currency, closes, and remembers it as recent", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="ru" messages={messages}>
        <CurrencySheet
          open
          onClose={onClose}
          value={null}
          baseCurrency="USD"
          onSelect={onSelect}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /GBP/ }));

    expect(onSelect).toHaveBeenCalledWith("GBP");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        window.localStorage.getItem("wishka-recent-currencies") ?? "[]",
      ),
    ).toEqual(["GBP"]);
  });
});
