import { CURRENCIES } from "./currencies";
import type { Locale } from "@/i18n/config";

/** UI locale → the BCP-47 tag `Intl.NumberFormat` groups and separates by. */
const NUMBER_LOCALE: Record<Locale, string> = {
  ru: "ru-RU",
  en: "en-US",
};

export type PriceInput = {
  priceType: "none" | "exact" | "range";
  priceMin: string | null; // numeric columns come back as strings
  priceMax: string | null;
  currency: string | null;
};

function symbolFor(code: string | null): string {
  if (!code) return "";
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

/** "1 400" — NBSP thousands, no trailing zeros. ICU versions disagree on
 *  the exact space character, so normalize to U+00A0 for stable output. */
function formatAmount(raw: string, locale: Locale): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/[  ]/g, " ");
}

/**
 * Card price line: "1 400 $" (exact) or "2 000–3 000 ₾" (range).
 * Returns null for no price — the card renders the "нет цены" nullpill.
 *
 * `locale` decides grouping and the decimal separator: ru-RU renders 1400.5 as
 * "1 400,5", en-US as "1,400.5" (invariant #7).
 */
export function formatPrice(input: PriceInput, locale: Locale): string | null {
  const symbol = symbolFor(input.currency);
  if (input.priceType === "exact" && input.priceMin != null) {
    return `${formatAmount(input.priceMin, locale)} ${symbol}`.trim();
  }
  if (
    input.priceType === "range" &&
    input.priceMin != null &&
    input.priceMax != null
  ) {
    return `${formatAmount(input.priceMin, locale)}–${formatAmount(input.priceMax, locale)} ${symbol}`.trim();
  }
  return null;
}
