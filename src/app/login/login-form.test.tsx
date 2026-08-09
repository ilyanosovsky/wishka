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
import { LoginForm } from "./login-form";

/**
 * Pins the code step against Better Auth's real emailOTP error codes
 * (`OTP_EXPIRED` / `INVALID_OTP` / `TOO_MANY_ATTEMPTS`, from
 * node_modules/better-auth/dist/plugins/email-otp/error-codes.mjs) and the
 * attempt budget the server enforces (`allowedAttempts: 5`).
 */

const sendVerificationOtp = vi.fn();
const signInEmailOtp = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (input: unknown) => sendVerificationOtp(input),
    },
    signIn: {
      emailOtp: (input: unknown) => signInEmailOtp(input),
      social: vi.fn(),
    },
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  sendVerificationOtp.mockResolvedValue({ data: {}, error: null });
});

async function reachCodeStep() {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <LoginForm />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Почта"), {
    target: { value: "ilya@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Получить код" }));
  await screen.findByText("Код из письма");
}

function typeCode(code: string) {
  // The first box owns the whole value: onChange fires verify at 6 digits.
  fireEvent.change(screen.getByLabelText("Цифра 1"), {
    target: { value: code[0] },
  });
  const boxes = screen.getAllByLabelText(/^Цифра /);
  for (let i = 1; i < code.length; i++) {
    fireEvent.change(boxes[i], { target: { value: code[i] } });
  }
}

describe("LoginForm — code step", () => {
  it("labels the six boxes in the active locale, not in English", async () => {
    await reachCodeStep();
    expect(screen.getAllByLabelText(/^Цифра /)).toHaveLength(6);
    expect(screen.getByLabelText("Цифра 6")).toBeInTheDocument();
    expect(screen.queryByLabelText("Digit 1")).not.toBeInTheDocument();
  });

  it("maps OTP_EXPIRED to the «код устарел» state", async () => {
    signInEmailOtp.mockResolvedValue({ error: { code: "OTP_EXPIRED" } });
    await reachCodeStep();
    typeCode("123456");

    expect(
      await screen.findByText("Код устарел — запроси новый"),
    ).toBeInTheDocument();
  });

  it("maps TOO_MANY_ATTEMPTS to the lockout state and disables the boxes", async () => {
    signInEmailOtp.mockResolvedValue({ error: { code: "TOO_MANY_ATTEMPTS" } });
    await reachCodeStep();
    typeCode("123456");

    expect(
      await screen.findByText(
        "Слишком много попыток — попробуй позже или измени почту",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Цифра 1")).toBeDisabled();
  });

  it("seeds the attempt counter from the server's budget of 5", async () => {
    signInEmailOtp.mockResolvedValue({ error: { code: "INVALID_OTP" } });
    await reachCodeStep();
    typeCode("123456");

    // 5 allowed submissions, one spent → 4 left.
    expect(
      await screen.findByText("Код не подошёл, осталось 4 попытки"),
    ).toBeInTheDocument();
  });

  it("navigates on a correct code", async () => {
    signInEmailOtp.mockResolvedValue({ error: null });
    await reachCodeStep();
    typeCode("123456");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/welcome"));
  });
});
