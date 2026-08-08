import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { deleteAccountAction } from "@/app/profile/actions";
import { DeleteAccount } from "./delete-account";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/app/profile/actions", () => ({
  deleteAccountAction: vi.fn(),
}));

const deleteAccountActionMock = vi.mocked(deleteAccountAction);

function renderControl() {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <DeleteAccount />
    </NextIntlClientProvider>,
  );
}

describe("DeleteAccount", () => {
  it("does not call the action until the destructive confirm is tapped", () => {
    // A successful delete redirects instead of resolving, so the honest stub
    // is a promise that never settles — the real component unmounts first.
    // Without it the mock would resolve `undefined`, the component would read
    // `.ok` off nothing, and this test would quietly assert the catch branch.
    deleteAccountActionMock.mockReturnValue(new Promise(() => {}));
    renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));
    expect(screen.getByText("Удалить аккаунт?")).toBeInTheDocument();
    expect(deleteAccountActionMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    expect(deleteAccountActionMock).toHaveBeenCalledTimes(1);
  });

  it("closing the dialog on cancel never calls the action", () => {
    renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.queryByText("Удалить аккаунт?")).not.toBeInTheDocument();
    expect(deleteAccountActionMock).not.toHaveBeenCalled();
  });

  it("shows a failure toast and re-enables retry when the action reports failure", async () => {
    deleteAccountActionMock.mockResolvedValue({ ok: false });
    renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));

    await waitFor(() =>
      expect(
        screen.getByText("Не получилось удалить — попробуй ещё раз"),
      ).toBeInTheDocument(),
    );
    // Dialog closed on failure so the user can reopen and retry.
    expect(screen.queryByText("Удалить аккаунт?")).not.toBeInTheDocument();
  });

  it("stays open and disables cancel while the request is in flight", async () => {
    let resolveAction: (value: { ok: false }) => void = () => {};
    deleteAccountActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));

    // Still in flight — the confirm label switches, and cancel is a no-op.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Удаляем…" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByText("Удалить аккаунт?")).toBeInTheDocument();

    // The action only ever resolves on failure; success redirects instead.
    resolveAction({ ok: false });
    await waitFor(() =>
      expect(deleteAccountActionMock).toHaveBeenCalledTimes(1),
    );
  });

  it("ignores a second confirm while the first is still in flight", async () => {
    // The second call would fail on an already-deleted account and flash a
    // false error over the first one's redirect.
    deleteAccountActionMock.mockReturnValue(new Promise(() => {}));
    renderControl();

    fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Удаляем…" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Удаляем…" }));

    expect(deleteAccountActionMock).toHaveBeenCalledTimes(1);
  });
});
