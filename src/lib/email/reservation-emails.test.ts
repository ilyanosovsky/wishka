// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendMock = vi.fn();

vi.mock("./client", () => ({
  getResend: () => ({ emails: { send: sendMock } }),
  getFromAddress: () => "Wishka <onboarding@resend.dev>",
}));

// Imported after the mock so the module under test picks up the mocked client.
const {
  sendGuestBookingConfirmation,
  sendReservedWishChanged,
  sendReservedWishDeleted,
  sendReservedWishHidden,
  sendGiftGiven,
} = await import("./reservation-emails");

describe("reservation email senders", () => {
  afterEach(() => {
    sendMock.mockReset();
  });

  it("sendGuestBookingConfirmation — RU subject, key phrases, CTA URL, HTML-escaped title", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendGuestBookingConfirmation({
      to: "guest@example.com",
      locale: "ru",
      guestName: "Аня",
      wishTitle: `<img src=x onerror=alert(1)> Кружка`,
      manageUrl: "https://wishka.app/g/tok123",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("Бронь подтверждена");
    expect(call.html).toContain("Управлять бронью");
    expect(call.html).toContain("https://wishka.app/g/tok123");
    expect(call.html).not.toContain("<img src=x");
    expect(call.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("sendGuestBookingConfirmation — EN subject and phrases", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendGuestBookingConfirmation({
      to: "guest@example.com",
      locale: "en",
      guestName: "Anna",
      wishTitle: "Mug",
      manageUrl: "https://wishka.app/g/tok123",
    });
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("Your booking is confirmed");
    expect(call.html).toContain("Manage booking");
    expect(call.html).toContain("https://wishka.app/g/tok123");
  });

  it("sendReservedWishChanged — includes changed fields and wish link (RU)", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendReservedWishChanged({
      to: "guest@example.com",
      locale: "ru",
      wishTitle: `<script>alert(1)</script>`,
      changedFields: ["title", "price"],
      wishAppUrl: "https://wishka.app/w/wish1",
    });
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("Владелец изменил желание");
    expect(call.html).toContain("название, цена");
    expect(call.html).toContain("https://wishka.app/w/wish1");
    expect(call.html).not.toContain("<script>");
  });

  it("sendReservedWishDeleted — RU/EN subjects and title in body", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendReservedWishDeleted({
      to: "guest@example.com",
      locale: "en",
      wishTitle: "Mug",
    });
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("The wish was deleted");
    expect(call.html).toContain("Mug");
  });

  it("sendReservedWishHidden — RU says the booking survives, and escapes the title", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendReservedWishHidden({
      to: "guest@example.com",
      locale: "ru",
      wishTitle: `<b>Кружка</b>`,
    });
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("Желание больше не видно");
    expect(call.html).toContain("Бронь остаётся за вами");
    expect(call.html).toContain("Мои брони");
    expect(call.html).not.toContain("<b>Кружка</b>");
    expect(call.html).toContain("&lt;b&gt;Кружка&lt;/b&gt;");
  });

  it("sendReservedWishHidden — EN, and no CTA to a wish that is gone", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendReservedWishHidden({
      to: "guest@example.com",
      locale: "en",
      wishTitle: "Mug",
    });
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("A wish you reserved is no longer visible");
    expect(call.html).toContain("My bookings");
    expect(call.html).not.toContain('href="https://');
  });

  it("sendGiftGiven — RU includes the exact confirmation phrase", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "x" }, error: null });
    await sendGiftGiven({
      to: "owner@example.com",
      locale: "ru",
      wishTitle: "Кружка",
    });
    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toBe("Подарок вручён 🎉");
    expect(call.html).toContain("Твой подарок отмечен как вручённый 🎉");
  });

  it("swallows a Resend error instead of throwing (runs inside after())", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "invalid `to` field" },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendGiftGiven({
        to: "not-an-email",
        locale: "en",
        wishTitle: "Mug",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("swallows a thrown network error too", async () => {
    sendMock.mockRejectedValueOnce(new Error("network down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendReservedWishDeleted({
        to: "guest@example.com",
        locale: "en",
        wishTitle: "Mug",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
