import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertBanner } from "./banner";

describe("AlertBanner", () => {
  it("interrupts for an error and stays polite otherwise", () => {
    const { rerender } = render(
      <AlertBanner tone="error">Не удалось сохранить</AlertBanner>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось сохранить");

    for (const tone of ["warning", "success", "info"] as const) {
      rerender(<AlertBanner tone={tone}>Черновик восстановлен</AlertBanner>);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Черновик восстановлен",
      );
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });

  it("gives the action a 44px tap target, as a button or a link", () => {
    const { rerender } = render(
      <AlertBanner tone="warning" actionLabel="Восстановить" onAction={vi.fn()}>
        Черновик найден
      </AlertBanner>,
    );
    expect(
      screen.getByRole("button", { name: "Восстановить" }).className,
    ).toContain("min-h-11");

    rerender(
      <AlertBanner tone="info" actionLabel="Открыть" actionHref="/wishes/1">
        Желание добавлено
      </AlertBanner>,
    );
    expect(screen.getByRole("link", { name: "Открыть" }).className).toContain(
      "min-h-11",
    );
  });
});
