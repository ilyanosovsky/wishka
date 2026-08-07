import { CURRENCIES } from "./currencies";

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
function formatAmount(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 })
    .format(value)
    .replace(/[  ]/g, " ");
}

/**
 * Card price line: "1 400 $" (exact) or "2 000–3 000 ₾" (range).
 * Returns null for no price — the card renders the "нет цены" nullpill.
 */
export function formatPrice(input: PriceInput): string | null {
  const symbol = symbolFor(input.currency);
  if (input.priceType === "exact" && input.priceMin != null) {
    return `${formatAmount(input.priceMin)} ${symbol}`.trim();
  }
  if (
    input.priceType === "range" &&
    input.priceMin != null &&
    input.priceMax != null
  ) {
    return `${formatAmount(input.priceMin)}–${formatAmount(input.priceMax)} ${symbol}`.trim();
  }
  return null;
}
