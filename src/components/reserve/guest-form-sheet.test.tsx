import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { GuestFormSheet } from "./guest-form-sheet";

/**
 * The guest introduction in isolation: validation, the two success shapes
 * (email given vs. asked for afterwards) and the two ways the wish can slip
 * away while the form is open.
 */

afterEach(cleanup);

const reserveAsGuestAction = vi.fn();
const saveGuestEmailAction = vi.fn();
vi.mock("@/app/reserve/actions", () => ({
  reserveAsGuestAction: (wishId: string, input: unknown) =>
    reserveAsGuestAction(wishId, input),
  saveGuestEmailAction: (wishId: string, email: string) =>
    saveGuestEmailAction(wishId, email),
}));

const WISH_ID = "wish-1";

function renderSheet() {
  const handlers = {
    onClose: vi.fn(),
    onReserved: vi.fn(),
    onDone: vi.fn(),
    onConflict: vi.fn(),
    onGone: vi.fn(),
  };
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <GuestFormSheet open wishId={WISH_ID} {...handlers} />
    </NextIntlClientProvider>,
  );
  return handlers;
}

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Забронировать" }));
}

beforeEach(() => {
  reserveAsGuestAction.mockReset();
  saveGuestEmailAction.mockReset();
});

describe("GuestFormSheet — validation", () => {
  it("refuses to submit without a name and never calls the action", () => {
    renderSheet();

    submit();

    expect(
      screen.getByText("Подскажи имя — так мы запомним бронь"),
    ).toBeInTheDocument();
    expect(reserveAsGuestAction).not.toHaveBeenCalled();
  });

  it("treats whitespace as no name at all", () => {
    renderSheet();

    typeInto("Имя", "   ");
    submit();

    expect(
      screen.getByText("Подскажи имя — так мы запомним бронь"),
    ).toBeInTheDocument();
    expect(reserveAsGuestAction).not.toHaveBeenCalled();
  });

  it("shows the server's email verdict on the email field", async () => {
    reserveAsGuestAction.mockResolvedValue({
      ok: false,
      reason: "invalid_email",
    });
    renderSheet();

    typeInto("Имя", "Маша");
    typeInto("Почта (необязательно)", "маша@");
    submit();

    expect(
      await screen.findByText("Похоже, в адресе опечатка"),
    ).toBeInTheDocument();
    // The hint gives way to the error, and the form stays put.
    expect(
      screen.queryByText(
        "Пришлём подтверждение и ссылку для управления бронью",
      ),
    ).toBeNull();
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });

  it("shows the server's name verdict on the name field", async () => {
    reserveAsGuestAction.mockResolvedValue({
      ok: false,
      reason: "invalid_name",
    });
    renderSheet();

    typeInto("Имя", "М".repeat(200));
    submit();

    expect(
      await screen.findByText("Подскажи имя — так мы запомним бронь"),
    ).toBeInTheDocument();
  });
});

describe("GuestFormSheet — success", () => {
  it("books with the trimmed name and a null email, then confirms", async () => {
    reserveAsGuestAction.mockResolvedValue({ ok: true, hasEmail: false });
    const { onReserved, onDone } = renderSheet();

    typeInto("Имя", "  Маша  ");
    submit();

    await waitFor(() =>
      expect(reserveAsGuestAction).toHaveBeenCalledWith(WISH_ID, {
        name: "Маша",
        email: null,
      }),
    );
    expect(onReserved).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "Владелец ничего не узнает — бронь видна только гостям списка.",
      ),
    ).toBeInTheDocument();
    // No email yet → the prompt is the whole point of this state.
    expect(
      screen.getByText(
        "Оставь почту — пришлём ссылку, чтобы управлять бронью с любого устройства",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Понятно" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skips the email prompt when the guest already left one", async () => {
    reserveAsGuestAction.mockResolvedValue({ ok: true, hasEmail: true });
    renderSheet();

    typeInto("Имя", "Маша");
    typeInto("Почта (необязательно)", "masha@example.com");
    submit();

    expect(await screen.findByText("Понятно")).toBeInTheDocument();
    expect(reserveAsGuestAction).toHaveBeenCalledWith(WISH_ID, {
      name: "Маша",
      email: "masha@example.com",
    });
    expect(
      screen.queryByText(
        "Оставь почту — пришлём ссылку, чтобы управлять бронью с любого устройства",
      ),
    ).toBeNull();
  });

  it("saves an email offered after the fact", async () => {
    reserveAsGuestAction.mockResolvedValue({ ok: true, hasEmail: false });
    saveGuestEmailAction.mockResolvedValue({ ok: true });
    renderSheet();

    typeInto("Имя", "Маша");
    submit();

    await screen.findByRole("button", { name: "Сохранить почту" });
    typeInto("Почта", "masha@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить почту" }));

    expect(
      await screen.findByText("Готово — письмо уже летит"),
    ).toBeInTheDocument();
    expect(saveGuestEmailAction).toHaveBeenCalledWith(
      WISH_ID,
      "masha@example.com",
    );
  });

  it("keeps the prompt open when the offered email is rejected", async () => {
    reserveAsGuestAction.mockResolvedValue({ ok: true, hasEmail: false });
    saveGuestEmailAction.mockResolvedValue({
      ok: false,
      reason: "invalid_email",
    });
    renderSheet();

    typeInto("Имя", "Маша");
    submit();

    await screen.findByRole("button", { name: "Сохранить почту" });
    typeInto("Почта", "masha@");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить почту" }));

    expect(
      await screen.findByText("Похоже, в адресе опечатка"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Готово — письмо уже летит")).toBeNull();
  });
});

describe("GuestFormSheet — the wish slips away", () => {
  it("hands a lost race to the panel", async () => {
    reserveAsGuestAction.mockResolvedValue({
      ok: false,
      reason: "already_reserved",
    });
    const { onConflict, onGone } = renderSheet();

    typeInto("Имя", "Маша");
    submit();

    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onGone).not.toHaveBeenCalled();
  });

  it("hands a deleted wish to the panel", async () => {
    reserveAsGuestAction.mockResolvedValue({ ok: false, reason: "not_found" });
    const { onConflict, onGone } = renderSheet();

    typeInto("Имя", "Маша");
    submit();

    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
    expect(onConflict).not.toHaveBeenCalled();
  });

  it("degrades calmly when the action rejects", async () => {
    reserveAsGuestAction.mockRejectedValue(new Error("network down"));
    const { onReserved } = renderSheet();

    typeInto("Имя", "Маша");
    submit();

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(onReserved).not.toHaveBeenCalled();
  });
});
