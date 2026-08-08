import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { MyReservation } from "@/db/access/my-reservations";
import { RECENT_LISTS_KEY } from "@/lib/recent-lists";
import { MyReservations } from "./my-reservations";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/reserve/actions", () => ({
  dismissReservationAction: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  window.localStorage.clear();
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
    owner: { userId: "owner-1", name: "Маша", nickname: "masha", image: null },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderTab(reservations: MyReservation[]) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <MyReservations reservations={reservations} />
    </NextIntlClientProvider>,
  );
}

describe("MyReservations", () => {
  it("shows the empty state and the email footnote", () => {
    renderTab([]);

    expect(
      screen.getByText("Тут появятся подарки, которые ты забронируешь."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Об изменениях владельца приходят письма"),
    ).toBeInTheDocument();
  });

  it("renders one card per booking", () => {
    renderTab([
      reservation(),
      reservation({ id: "res-2", wishId: "w-2", title: "Термос" }),
    ]);

    expect(screen.getByText("Керамическая ваза")).toBeInTheDocument();
    expect(screen.getByText("Термос")).toBeInTheDocument();
  });

  it("omits the recent-lists block until there is something to show", () => {
    renderTab([]);
    expect(screen.queryByText("Недавно просмотренные списки")).toBeNull();
  });

  it("lists recently viewed lists from local storage", async () => {
    window.localStorage.setItem(
      RECENT_LISTS_KEY,
      JSON.stringify([{ nickname: "masha", name: "masha", at: 10 }]),
    );

    renderTab([]);

    expect(
      await screen.findByText("Недавно просмотренные списки"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /masha/ })).toHaveAttribute(
      "href",
      "/u/masha",
    );
  });
});
