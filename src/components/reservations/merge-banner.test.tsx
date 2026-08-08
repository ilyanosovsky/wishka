import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { MergeBanner } from "./merge-banner";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const mergeGuestReservationsAction = vi.fn(async () => ({
  ok: true,
  moved: 2,
}));
vi.mock("@/app/reserve/actions", () => ({
  mergeGuestReservationsAction: () => mergeGuestReservationsAction(),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  refresh.mockClear();
  mergeGuestReservationsAction.mockClear();
  mergeGuestReservationsAction.mockImplementation(async () => ({
    ok: true,
    moved: 2,
  }));
});

function renderBanner(count = 2) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <MergeBanner count={count} />
    </NextIntlClientProvider>,
  );
}

describe("MergeBanner", () => {
  it("renders nothing when there is nothing to merge", async () => {
    const { container } = renderBanner(0);
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Перенести" })).toBeNull(),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers both actions with a pluralized count", async () => {
    renderBanner(2);

    expect(
      await screen.findByText(
        "Нашли 2 ваши гостевые брони — перенести в аккаунт?",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Перенести" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Не сейчас" }),
    ).toBeInTheDocument();
  });

  it("merges, confirms with a toast and refreshes", async () => {
    renderBanner();

    fireEvent.click(await screen.findByRole("button", { name: "Перенести" }));

    await vi.waitFor(() => {
      expect(mergeGuestReservationsAction).toHaveBeenCalled();
      expect(refresh).toHaveBeenCalled();
    });
    expect(
      await screen.findByText("Брони перенесены в аккаунт"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Перенести" })).toBeNull();
  });

  it("keeps the prompt up when the merge fails", async () => {
    mergeGuestReservationsAction.mockImplementation(async () => ({
      ok: false,
      moved: 0,
    }));
    renderBanner();

    fireEvent.click(await screen.findByRole("button", { name: "Перенести" }));

    await vi.waitFor(() =>
      expect(mergeGuestReservationsAction).toHaveBeenCalled(),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Перенести" }),
    ).toBeInTheDocument();
  });

  it("«Не сейчас» hides it for the rest of the session", async () => {
    const { unmount } = renderBanner();

    fireEvent.click(await screen.findByRole("button", { name: "Не сейчас" }));
    expect(screen.queryByRole("button", { name: "Перенести" })).toBeNull();
    expect(mergeGuestReservationsAction).not.toHaveBeenCalled();
    unmount();

    // A later navigation in the same tab must not ask again.
    renderBanner();
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Перенести" })).toBeNull(),
    );
  });
});
