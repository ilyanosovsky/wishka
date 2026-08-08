import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { ReservePanel } from "./reserve-panel";
import type { ReservationStatus } from "@/db/access/types";

/**
 * The panel's state matrix and every losing race, with the server actions
 * mocked — no DB, no session, no cookie. What is asserted is which action
 * fires and which exit the viewer lands in.
 */

afterEach(cleanup);

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const reserveWishAction = vi.fn();
const cancelReservationAction = vi.fn();
const reserveAsGuestAction = vi.fn();
const saveGuestEmailAction = vi.fn();
vi.mock("@/app/reserve/actions", () => ({
  reserveWishAction: (wishId: string) => reserveWishAction(wishId),
  cancelReservationAction: (wishId: string) => cancelReservationAction(wishId),
  reserveAsGuestAction: (wishId: string, input: unknown) =>
    reserveAsGuestAction(wishId, input),
  saveGuestEmailAction: (wishId: string, email: string) =>
    saveGuestEmailAction(wishId, email),
}));

const WISH_ID = "wish-1";
const LIST_HREF = "/u/masha";

function renderPanel(
  reservationStatus: ReservationStatus,
  { isGuest = true }: { isGuest?: boolean } = {},
) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ReservePanel
        wishId={WISH_ID}
        reservationStatus={reservationStatus}
        isGuest={isGuest}
        listHref={LIST_HREF}
      />
    </NextIntlClientProvider>,
  );
}

/** The confirm dialog's CTA shares its label with other buttons on screen. */
function confirmInDialog(name: string) {
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name }),
  );
}

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
  reserveWishAction.mockReset();
  cancelReservationAction.mockReset();
  reserveAsGuestAction.mockReset();
  saveGuestEmailAction.mockReset();
});

describe("ReservePanel — state matrix", () => {
  it("offers the reserve CTA when the wish is free", () => {
    renderPanel("free");

    expect(
      screen.getByRole("button", { name: "Забронирую" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Снять бронь" })).toBeNull();
    expect(screen.queryByText("Забронировано")).toBeNull();
  });

  it("shows the badge, the 'what else is free' link and the guest hint when someone else holds it", () => {
    renderPanel("reserved");

    expect(screen.getByText("Забронировано")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Посмотреть, что ещё свободно" }),
    ).toHaveAttribute("href", LIST_HREF);
    expect(
      screen.getByText(
        "Это вы бронировали? Откройте ссылку из письма — бронь подтянется на это устройство.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Забронирую" })).toBeNull();
  });

  it("keeps the other-device hint away from signed-in viewers", () => {
    renderPanel("reserved", { isGuest: false });

    expect(
      screen.queryByText(
        "Это вы бронировали? Откройте ссылку из письма — бронь подтянется на это устройство.",
      ),
    ).toBeNull();
  });

  it("shows the own-booking badge and the release CTA", () => {
    renderPanel("reserved_by_you");

    expect(screen.getByText("Забронировано вами")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Снять бронь" }),
    ).toBeInTheDocument();
  });
});

describe("ReservePanel — reserving", () => {
  it("confirms first, then reserves, refreshes and toasts", async () => {
    reserveWishAction.mockResolvedValue({ ok: true });
    renderPanel("free");

    fireEvent.click(screen.getByRole("button", { name: "Забронирую" }));
    expect(screen.getByText("Забронировать это желание?")).toBeInTheDocument();
    expect(reserveWishAction).not.toHaveBeenCalled();

    confirmInDialog("Забронировать");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(reserveWishAction).toHaveBeenCalledWith(WISH_ID);
    expect(screen.getByText("Бронь за вами")).toBeInTheDocument();
    expect(screen.getByText("Забронировано вами")).toBeInTheDocument();
  });

  it("opens the guest form when nobody is identified yet", async () => {
    reserveWishAction.mockResolvedValue({ ok: false, reason: "need_guest" });
    renderPanel("free");

    fireEvent.click(screen.getByRole("button", { name: "Забронирую" }));
    confirmInDialog("Забронировать");

    expect(
      await screen.findByRole("dialog", { name: "Как вас записать?" }),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls into the conflict sheet when someone booked first", async () => {
    reserveWishAction.mockResolvedValue({
      ok: false,
      reason: "already_reserved",
    });
    renderPanel("free");

    fireEvent.click(screen.getByRole("button", { name: "Забронирую" }));
    confirmInDialog("Забронировать");

    expect(
      await screen.findByRole("dialog", { name: "Увы, это уже забронировали" }),
    ).toBeInTheDocument();
    // The panel behind the sheet now tells the truth as well.
    expect(screen.getByText("Забронировано")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Посмотреть, что свободно" }),
    ).toHaveAttribute("href", LIST_HREF);
  });

  it("sends the viewer back to the list when the owner deleted the wish", async () => {
    reserveWishAction.mockResolvedValue({ ok: false, reason: "not_found" });
    renderPanel("free");

    fireEvent.click(screen.getByRole("button", { name: "Забронирую" }));
    confirmInDialog("Забронировать");

    expect(
      await screen.findByText("Владелец удалил это желание"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Вернуться к списку" }));
    expect(push).toHaveBeenCalledWith(LIST_HREF);
  });

  it("surfaces a calm failure when the action itself rejects", async () => {
    reserveWishAction.mockRejectedValue(new Error("network down"));
    renderPanel("free");

    fireEvent.click(screen.getByRole("button", { name: "Забронирую" }));
    confirmInDialog("Забронировать");

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ReservePanel — releasing and undo", () => {
  it("confirms, cancels, and offers an undo that re-reserves", async () => {
    cancelReservationAction.mockResolvedValue({ ok: true });
    reserveWishAction.mockResolvedValue({ ok: true });
    renderPanel("reserved_by_you");

    fireEvent.click(screen.getByRole("button", { name: "Снять бронь" }));
    expect(screen.getByText("Снять бронь?")).toBeInTheDocument();
    confirmInDialog("Снять бронь");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(cancelReservationAction).toHaveBeenCalledWith(WISH_ID);
    expect(screen.getByText("Бронь снята")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Забронирую" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));

    await waitFor(() =>
      expect(reserveWishAction).toHaveBeenCalledWith(WISH_ID),
    );
    expect(screen.getByText("Забронировано вами")).toBeInTheDocument();
  });

  it("lands undo in the conflict sheet when the wish was taken meanwhile", async () => {
    cancelReservationAction.mockResolvedValue({ ok: true });
    reserveWishAction.mockResolvedValue({
      ok: false,
      reason: "already_reserved",
    });
    renderPanel("reserved_by_you");

    fireEvent.click(screen.getByRole("button", { name: "Снять бронь" }));
    confirmInDialog("Снять бронь");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));

    expect(
      await screen.findByRole("dialog", { name: "Увы, это уже забронировали" }),
    ).toBeInTheDocument();
  });

  it("reports a refused cancel instead of pretending it worked", async () => {
    cancelReservationAction.mockResolvedValue({ ok: false });
    renderPanel("reserved_by_you");

    fireEvent.click(screen.getByRole("button", { name: "Снять бронь" }));
    confirmInDialog("Снять бронь");

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Забронировано вами")).toBeInTheDocument();
  });
});

describe("ReservePanel — server truth wins", () => {
  it("adopts a status that a refresh brought down", () => {
    const { rerender } = renderPanel("free");
    expect(
      screen.getByRole("button", { name: "Забронирую" }),
    ).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="ru" messages={messages}>
        <ReservePanel
          wishId={WISH_ID}
          reservationStatus="reserved"
          isGuest
          listHref={LIST_HREF}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Забронировано")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Забронирую" })).toBeNull();
  });
});
