/**
 * Turning whatever a shop wrote into the two things the wish form takes:
 * a `numeric`-safe amount string and an ISO 4217 code.
 *
 * Sources are wildly inconsistent — "$1,299.00", "1 299,00 ₾", "1.299,00 €",
 * JSON-LD `"price": 1299` — so the separator has to be inferred rather than
 * assumed. Sibling of `src/lib/price.ts`, which does the opposite direction
 * (stored value → display string).
 */

/** Symbols we can map with confidence. Ambiguous ones ($ → USD) take the most
 *  common reading; the user can change the currency in the form. */
const SYMBOL_TO_CODE: [string, string][] = [
  ["₾", "GEL"],
  ["₽", "RUB"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["֏", "AMD"],
  ["₺", "TRY"],
  ["₴", "UAH"],
  ["₸", "KZT"],
  ["₪", "ILS"],
  ["¥", "JPY"],
  ["₹", "INR"],
  ["$", "USD"],
];

/** Codes we accept when a page names the currency in letters. An allow-list,
 *  not `[A-Z]{3}`, so "THE" or "NEW" in a title cannot become a currency. */
const KNOWN_CODES = new Set(
  (
    "USD EUR GEL RUB GBP AMD TRY UAH KZT ILS JPY INR PLN CZK SEK NOK DKK CHF " +
    "CAD AUD CNY AED BYN HUF RON BGN NZD SGD HKD KRW BRL MXN ZAR THB VND IDR " +
    "MYR PHP SAR QAR"
  ).split(" "),
);

export function detectCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().match(/\b[A-Z]{3}\b/g);
  if (code) {
    const known = code.find((candidate) => KNOWN_CODES.has(candidate));
    if (known) return known;
  }
  for (const [symbol, mapped] of SYMBOL_TO_CODE) {
    if (raw.includes(symbol)) return mapped;
  }
  return null;
}

/** numeric(12, 2) in the wishes table — anything larger is junk, not a price. */
const MAX_AMOUNT = 9_999_999_999.99;

/**
 * Extracts the first amount in `raw` and returns it as "1299.00", or null.
 *
 * Separator rules, in order:
 *   both "," and "." present → the *last* one is the decimal separator;
 *   one of them, followed by exactly 1–2 digits at the end → decimal;
 *   otherwise → thousands grouping, dropped.
 */
export function normalizeAmount(raw: unknown): string | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 && raw <= MAX_AMOUNT
      ? raw.toFixed(2)
      : null;
  }
  if (typeof raw !== "string") return null;

  // Keep digits and separators only; strip spaces (incl. NBSP/thin space).
  const match = raw.replace(/[\s   ]/g, "").match(/\d[\d.,]*/);
  if (!match) return null;
  let text = match[0].replace(/[.,]+$/, "");

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let decimalAt = -1;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else {
    const only = Math.max(lastComma, lastDot);
    if (only >= 0 && /^\d{1,2}$/.test(text.slice(only + 1))) decimalAt = only;
  }

  if (decimalAt >= 0) {
    text =
      text.slice(0, decimalAt).replace(/[.,]/g, "") +
      "." +
      text.slice(decimalAt + 1);
  } else {
    text = text.replace(/[.,]/g, "");
  }

  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;
  return value.toFixed(2);
}
