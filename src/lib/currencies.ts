/** Starter set for onboarding; every wish stores its own currency anyway. */
export const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
  { code: "GEL", symbol: "₾" },
  { code: "RUB", symbol: "₽" },
  { code: "GBP", symbol: "£" },
  { code: "AMD", symbol: "֏" },
  { code: "TRY", symbol: "₺" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCIES.some((c) => c.code === value);
}
