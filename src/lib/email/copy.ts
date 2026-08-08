/**
 * Email copy — RU + EN, kept separate from messages/*.json (next-intl is for
 * UI strings; these are server-rendered outside any request locale context).
 * Tone: ты-form for account emails (gift-given), вы-form for guest emails
 * (booking confirmation, wish changed/deleted — a guest may not have an
 * account at all). Mirrors the voice of reserve.* / myReservations.* in
 * messages/ru.json.
 */

export type Locale = "ru" | "en";

// Mirrors ReservationChangedField from src/db/access/my-reservations.ts.
// Duplicated (not imported) so this module has no dependency on the
// data-access layer — email senders take ready primitives, not DB types.
export type ReservationChangedField = "title" | "price" | "url";

const CHANGED_FIELD_RU: Record<ReservationChangedField, string> = {
  title: "название",
  price: "цена",
  url: "ссылка",
};

const CHANGED_FIELD_EN: Record<ReservationChangedField, string> = {
  title: "title",
  price: "price",
  url: "link",
};

export function formatChangedFields(
  fields: ReservationChangedField[],
  locale: Locale,
): string {
  const dict = locale === "ru" ? CHANGED_FIELD_RU : CHANGED_FIELD_EN;
  return fields.map((f) => dict[f]).join(", ");
}

export const guestBookingConfirmation = {
  subject: {
    ru: "Бронь подтверждена",
    en: "Your booking is confirmed",
  },
  heading: {
    ru: "Бронь подтверждена",
    en: "Booking confirmed",
  },
  body: (wishTitle: string, locale: Locale): string[] =>
    locale === "ru"
      ? [
          `Вы забронировали подарок «${wishTitle}». Владелец списка не увидит эту бронь — это часть режима сюрприза.`,
          "Ссылка ниже открывает управление бронью на любом устройстве — сохраните письмо.",
        ]
      : [
          `You've reserved the gift "${wishTitle}". The list owner will never see this booking — that's the surprise mode.`,
          "The link below opens booking management on any device — keep this email.",
        ],
  cta: {
    ru: "Управлять бронью",
    en: "Manage booking",
  },
};

export const reservedWishChanged = {
  subject: {
    ru: "Владелец изменил желание",
    en: "The owner changed this wish",
  },
  heading: {
    ru: "Владелец изменил желание",
    en: "The wish was changed",
  },
  body: (
    wishTitle: string,
    changedFieldsLabel: string,
    locale: Locale,
  ): string[] =>
    locale === "ru"
      ? [
          `Желание «${wishTitle}», которое вы забронировали, изменилось: ${changedFieldsLabel}.`,
          "Загляните в список, чтобы проверить, актуальна ли ваша бронь.",
        ]
      : [
          `The wish "${wishTitle}" you reserved has changed: ${changedFieldsLabel}.`,
          "Check the list to see if your booking is still what you expect.",
        ],
  cta: {
    ru: "Открыть желание",
    en: "Open the wish",
  },
};

export const reservedWishDeleted = {
  subject: {
    ru: "Желание удалено владельцем",
    en: "The wish was deleted",
  },
  heading: {
    ru: "Желание удалено владельцем",
    en: "The wish was deleted by the owner",
  },
  body: (wishTitle: string, locale: Locale): string[] =>
    locale === "ru"
      ? [
          `Желание «${wishTitle}», которое вы забронировали, владелец удалил из списка. Бронь больше не действует.`,
        ]
      : [
          `The wish "${wishTitle}" you reserved was removed by the owner. The booking no longer applies.`,
        ],
};

export const giftGiven = {
  subject: {
    ru: "Подарок вручён 🎉",
    en: "Gift delivered 🎉",
  },
  heading: {
    ru: "Подарок вручён 🎉",
    en: "Gift delivered 🎉",
  },
  body: (wishTitle: string, locale: Locale): string[] =>
    locale === "ru"
      ? [
          `Твой подарок отмечен как вручённый 🎉`,
          `Желание «${wishTitle}» закрыто — спасибо, что порадовал(а)!`,
        ]
      : [
          `Your gift is marked as delivered 🎉`,
          `The wish "${wishTitle}" is now closed — thanks for making someone happy!`,
        ],
};
