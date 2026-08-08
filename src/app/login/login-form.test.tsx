import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { LoginForm } from "./login-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

// The auth client's browser SDK is replaced with plain spies so the two
// post-login destinations — Google's callbackURL and the OTP-verify router
// push — can be asserted directly.
const { signInSocial, signInWithOtp, sendVerificationOtp } = vi.hoisted(() => ({
  signInSocial: vi.fn(),
  signInWithOtp: vi.fn(),
  sendVerificationOtp: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: { social: signInSocial, emailOtp: signInWithOtp },
    emailOtp: { sendVerificationOtp },
  },
}));

beforeEach(() => {
  push.mockClear();
  // Every auth call succeeds by default; a test opts into failure if it needs to.
  signInSocial.mockReset().mockResolvedValue({ error: null });
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  sendVerificationOtp.mockReset().mockResolvedValue({ error: null });
});

function renderLogin(next?: string) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <LoginForm next={next} />
    </NextIntlClientProvider>,
  );
}

describe("LoginForm — Google OAuth callbackURL", () => {
  it("targets /welcome directly for the default (root) next", async () => {
    renderLogin("/");
    fireEvent.click(screen.getByRole("button", { name: "Войти через Google" }));

    await vi.waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/welcome",
      }),
    );
  });

  it("threads an encoded next into the callbackURL for a non-root target", async () => {
    renderLogin("/wishes/1");
    fireEvent.click(screen.getByRole("button", { name: "Войти через Google" }));

    await vi.waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/welcome?next=%2Fwishes%2F1",
      }),
    );
  });
});

describe("LoginForm — OTP verify redirect", () => {
  async function driveToCodeStep(next?: string) {
    renderLogin(next);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
      target: { value: "friend@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Получить код" }));
    // sendVerificationOtp resolving flips the form to the six-box code step.
    await screen.findByLabelText("Digit 1");
  }

  function enterCode(code: string) {
    for (let i = 0; i < code.length; i++) {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1}`), {
        target: { value: code[i] },
      });
    }
  }

  it("pushes /welcome with no next for the default (root) target", async () => {
    await driveToCodeStep("/");
    enterCode("123456");

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/welcome"));
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "friend@example.com",
      otp: "123456",
    });
  });

  it("pushes /welcome?next=<encoded> for a non-root target", async () => {
    await driveToCodeStep("/wishes/1");
    enterCode("123456");

    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/welcome?next=%2Fwishes%2F1"),
    );
  });
});
