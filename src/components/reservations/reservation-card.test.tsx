import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { MyReservation } from "@/db/access/my-reservations";
import { ReservationCard } from "./reservation-card";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const dismissReservationAction = vi.fn(async (id: string) => {
  void id;
  return { ok: true };
});
vi.mock("@/app/reserve/actions", () => ({
  dismissReservationAction: (id: string) => dismissReservationAction(id),
}));

beforeEach(() => {
  refresh.mockClear();
  dismissReservationAction.mockClear();
  dismissReservationAction.mockImplementation(async () => ({ ok: true }));
});

function reservation(overrides: Partial<MyReservation> = {}): MyReservation {
  return {
    id: "res-1",
    wishId: "w-1",
    state: "active",
    changedFields: [],
    title: "Керамическая ваза",
    reservedTitle: "Керамическая ваза",
    url: null,
    imageKey: null,
    priceType: "none",
    priceMin: null,
    priceMax: null,
    currency: null,
    owner: {
      userId: "owner-1",
      name: "Маша",
      nickname: "masha",
      image: null,
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderCard(overrides: Partial<MyReservation> = {}) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ReservationCard reservation={reservation(overrides)} />
    </NextIntlClientProvider>,
  );
}

describe("ReservationCard — state matrix", () => {
  it("active: own-booking chip, wish link and a release action", () => {
    renderCard();

    expect(screen.getByText("Забронировано вами")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Керамическая ваза" }),
    ).toHaveAttribute("href", "/w/w-1");
    expect(
      screen.getByRole("button", { name: "Снять бронь" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Убрать" })).toBeNull();
  });

  it("changed: lists the changed fields and the previous title", () => {
    renderCard({
      state: "changed",
      changedFields: ["title", "price"],
      title: "Ваза из Тбилиси",
      reservedTitle: "Керамическая ваза",
    });

    expect(screen.getByText("Владелец изменил желание")).toBeInTheDocument();
    expect(screen.getByText("Изменилось: название, цена")).toBeInTheDocument();
    expect(screen.getByText("Было: Керамическая ваза")).toBeInTheDocument();
    // Still a live booking — it is released, not dismissed.
    expect(
      screen.getByRole("button", { name: "Снять бронь" }),
    ).toBeInTheDocument();
  });

  it("changed without a title edit: no «было» line", () => {
    renderCard({ state: "changed", changedFields: ["url"] });

    expect(screen.getByText("Изменилось: ссылка")).toBeInTheDocument();
    expect(screen.queryByText(/^Было:/)).toBeNull();
  });

  it("deleted: renders the snapshot title, no wish link, dismiss action", () => {
    renderCard({
      state: "deleted",
      wishId: null,
      title: "Керамическая ваза",
      imageKey: null,
    });

    expect(screen.getByText("Желание удалено владельцем")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Керамическая ваза" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Убрать" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Снять бронь" })).toBeNull();
  });

  it("given: gifted chip and a dismiss action", () => {
    renderCard({ state: "given" });

    expect(screen.getByText("Подарок вручён")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Убрать" })).toBeInTheDocument();
  });

  it("links the owner to their public list only when they have a nickname", () => {
    const { unmount } = renderCard();
    expect(screen.getByRole("link", { name: /Маша/ })).toHaveAttribute(
      "href",
      "/u/masha",
    );
    unmount();

    renderCard({
      owner: {
        userId: "owner-1",
        name: "Маша",
        nickname: null,
        image: null,
      },
    });
    expect(screen.queryByRole("link", { name: /Маша/ })).toBeNull();
    expect(screen.getByText("Маша")).toBeInTheDocument();
  });

  it("shows the price when the wish has one", () => {
    renderCard({ priceType: "exact", priceMin: "1400", currency: "USD" });
    expect(screen.getByText("1 400 $")).toBeInTheDocument();
  });
});

describe("ReservationCard — actions", () => {
  it("confirms before releasing a live booking, then refreshes", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Снять бронь" }));
    expect(dismissReservationAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Снять бронь?")).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Снять бронь" }),
    );
    await vi.waitFor(() => {
      expect(dismissReservationAction).toHaveBeenCalledWith("res-1");
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("cancelling the dialog leaves the booking alone", () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Снять бронь" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dismissReservationAction).not.toHaveBeenCalled();
  });

  it("dismisses a settled row with no confirmation", async () => {
    renderCard({ state: "given" });

    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await vi.waitFor(() => {
      expect(dismissReservationAction).toHaveBeenCalledWith("res-1");
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("surfaces a failed action instead of refreshing", async () => {
    dismissReservationAction.mockImplementation(async () => ({ ok: false }));
    renderCard({ state: "deleted", wishId: null });

    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));

    await vi.waitFor(() => {
      expect(
        screen.getByText("Не получилось — попробуй ещё раз"),
      ).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
