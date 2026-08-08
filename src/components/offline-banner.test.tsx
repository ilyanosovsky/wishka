import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/ru.json";
import { OfflineBanner } from "./offline-banner";

afterEach(cleanup);

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function renderBanner() {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <OfflineBanner />
    </NextIntlClientProvider>,
  );
}

describe("OfflineBanner", () => {
  beforeEach(() => setOnline(true));

  it("renders nothing while online", () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the offline copy as soon as the browser goes offline", () => {
    setOnline(true);
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(
      screen.getByText("Нет сети — показываем сохранённое"),
    ).toBeInTheDocument();
  });

  it("mounts already-offline when navigator.onLine is false on first render", () => {
    setOnline(false);
    renderBanner();
    expect(
      screen.getByText("Нет сети — показываем сохранённое"),
    ).toBeInTheDocument();
  });

  it("hides again once connectivity returns", () => {
    setOnline(false);
    renderBanner();
    expect(
      screen.getByText("Нет сети — показываем сохранённое"),
    ).toBeInTheDocument();

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByText("Нет сети — показываем сохранённое")).toBeNull();
  });
});
