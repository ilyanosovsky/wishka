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
import { SignOutButton } from "./sign-out-button";

const signOut = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: () => signOut() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

beforeEach(() => {
  signOut.mockResolvedValue({ data: null, error: null });
});

function renderControl() {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <SignOutButton />
    </NextIntlClientProvider>,
  );
}

/** The two buttons share the label «Выйти»: [0] is the trigger, [1] the
 *  dialog's destructive confirm (the dialog renders after it in the tree). */
function signOutButtons() {
  return screen.getAllByRole("button", { name: "Выйти" });
}

describe("SignOutButton", () => {
  it("asks for confirmation instead of signing out on the first tap", () => {
    renderControl();

    fireEvent.click(signOutButtons()[0]);

    expect(screen.getByText("Выйти из аккаунта?")).toBeInTheDocument();
    expect(
      screen.getByText("Черновики желаний на этом устройстве будут удалены"),
    ).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("cancelling closes the dialog and keeps the session and the drafts", () => {
    window.localStorage.setItem("wishka-wish-draft:new", "{}");
    renderControl();

    fireEvent.click(signOutButtons()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.queryByText("Выйти из аккаунта?")).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("wishka-wish-draft:new")).toBe("{}");
  });

  it("confirming signs out, wipes only the wish drafts, and refreshes", async () => {
    window.localStorage.setItem("wishka-wish-draft:new", "{}");
    window.localStorage.setItem("wishka-wish-draft:42", "{}");
    window.localStorage.setItem("wishka-locale", "ru");
    renderControl();

    fireEvent.click(signOutButtons()[0]);
    fireEvent.click(signOutButtons()[1]);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("wishka-wish-draft:new")).toBeNull();
    expect(window.localStorage.getItem("wishka-wish-draft:42")).toBeNull();
    expect(window.localStorage.getItem("wishka-locale")).toBe("ru");
  });

  /**
   * `authClient.signOut()` resolves with `{ data, error }` instead of throwing,
   * so a 500/403 used to sail straight into the draft wipe and the refresh
   * while the session was still valid. Both failure shapes are pinned here.
   */
  it("keeps the drafts, the session and the dialog when sign-out fails", async () => {
    signOut.mockResolvedValue({
      data: null,
      error: { status: 500, message: "boom" },
    });
    window.localStorage.setItem("wishka-wish-draft:new", "{}");
    renderControl();

    fireEvent.click(signOutButtons()[0]);
    fireEvent.click(signOutButtons()[1]);

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    // Still signed in: nothing was deleted and nothing was re-rendered as if
    // the session had gone.
    expect(window.localStorage.getItem("wishka-wish-draft:new")).toBe("{}");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("Выйти из аккаунта?")).toBeInTheDocument();
  });

  it("treats a rejected sign-out the same way", async () => {
    signOut.mockRejectedValue(new Error("offline"));
    window.localStorage.setItem("wishka-wish-draft:new", "{}");
    renderControl();

    fireEvent.click(signOutButtons()[0]);
    fireEvent.click(signOutButtons()[1]);

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("wishka-wish-draft:new")).toBe("{}");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the failure when the dialog is dismissed and retried", async () => {
    signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    renderControl();

    fireEvent.click(signOutButtons()[0]);
    fireEvent.click(signOutButtons()[1]);
    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    fireEvent.click(signOutButtons()[0]);

    expect(
      screen.queryByText("Не получилось — попробуй ещё раз"),
    ).not.toBeInTheDocument();
  });
});
