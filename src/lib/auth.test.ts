// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Imported after the mock; `betterAuth()` itself never runs here — `getAuth()`
// is a lazy singleton, so the module is importable without any env.
const { buildOtpEmail, OTP_ALLOWED_ATTEMPTS } = await import("./auth");

describe("buildOtpEmail", () => {
  it("renders the sign-in code in RU, through the shared ledger shell", () => {
    const { subject, html, text } = buildOtpEmail("sign-in", "123456", "ru");
    expect(subject).toBe("Код входа в Wishka");
    expect(html).toContain("Ваш код входа:");
    expect(html).toContain("123456");
    expect(html).toContain("Код действует 15 минут");
    // The ledger shell, not a bare text body.
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain("Wishka");
    expect(text).toContain("Ваш код входа:");
    expect(text).toContain("123456");
  });

  it("renders the sign-in code in EN", () => {
    const { subject, html, text } = buildOtpEmail("sign-in", "654321", "en");
    expect(subject).toBe("Your Wishka sign-in code");
    expect(html).toContain("Your sign-in code:");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("The code expires in 15 minutes");
    expect(text).toContain("654321");
  });

  it("localizes the verification and recovery variants too", () => {
    expect(buildOtpEmail("email-verification", "1", "ru").subject).toBe(
      "Подтвердите почту для Wishka",
    );
    expect(buildOtpEmail("forget-password", "1", "ru").subject).toBe(
      "Код восстановления для Wishka",
    );
    expect(buildOtpEmail("email-verification", "1", "en").subject).toBe(
      "Confirm your email for Wishka",
    );
  });

  it("falls back to the sign-in copy for an unknown OTP type", () => {
    expect(buildOtpEmail("something-new", "1", "ru").subject).toBe(
      "Код входа в Wishka",
    );
  });

  it("never leaks the English default into a RU email", () => {
    const { html } = buildOtpEmail("sign-in", "123456", "ru");
    expect(html).not.toContain("Your sign-in code");
    expect(html).not.toContain("The code expires");
  });

  it("pins the attempt budget the login screen mirrors", () => {
    expect(OTP_ALLOWED_ATTEMPTS).toBe(5);
  });
});
