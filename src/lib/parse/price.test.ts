// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectCurrency, normalizeAmount } from "./price";

describe("normalizeAmount", () => {
  it.each([
    ["129", "129.00"],
    ["129.00", "129.00"],
    ["129,00", "129.00"],
    ["$1,299.00", "1299.00"],
    ["1.299,00 €", "1299.00"],
    ["1 299,00 ₾", "1299.00"],
    ["1 299 ₽", "1299.00"],
    ["от 2 000 ₽", "2000.00"],
    ["1,299", "1299.00"],
    ["USD 49.99", "49.99"],
  ])("reads %s as %s", (input, expected) => {
    expect(normalizeAmount(input)).toBe(expected);
  });

  it("accepts JSON-LD numbers", () => {
    expect(normalizeAmount(129)).toBe("129.00");
  });

  it.each([null, undefined, "", "free", "Sold out", 0, -5, 1e12, NaN])(
    "rejects %j",
    (input) => {
      expect(normalizeAmount(input)).toBeNull();
    },
  );
});

describe("detectCurrency", () => {
  it.each([
    ["129 ₾", "GEL"],
    ["1 299 ₽", "RUB"],
    ["€49,99", "EUR"],
    ["$19.99", "USD"],
    ["£19.99", "GBP"],
    ["12 000 ֏", "AMD"],
    ["₺450", "TRY"],
    ["GEL", "GEL"],
    ["Price: 49.99 usd", "USD"],
  ])("reads %s as %s", (input, expected) => {
    expect(detectCurrency(input)).toBe(expected);
  });

  it("ignores three-letter words that are not currencies", () => {
    expect(detectCurrency("THE NEW VASE")).toBeNull();
  });

  it.each([null, undefined, 42, ""])("returns null for %j", (input) => {
    expect(detectCurrency(input)).toBeNull();
  });
});
