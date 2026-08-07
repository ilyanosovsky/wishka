import { describe, expect, it } from "vitest";
import { formatPrice } from "./price";

describe("formatPrice", () => {
  const NBSP = " ";

  it("formats an exact price with a known symbol", () => {
    expect(
      formatPrice({
        priceType: "exact",
        priceMin: "1400",
        priceMax: null,
        currency: "USD",
      }),
    ).toBe(`1${NBSP}400 $`);
  });

  it("formats a range with the lari symbol", () => {
    expect(
      formatPrice({
        priceType: "range",
        priceMin: "2000",
        priceMax: "3000",
        currency: "GEL",
      }),
    ).toBe(`2${NBSP}000–3${NBSP}000 ₾`);
  });

  it("falls back to the currency code when the symbol is unknown", () => {
    expect(
      formatPrice({
        priceType: "exact",
        priceMin: "99.5",
        priceMax: null,
        currency: "JPY",
      }),
    ).toBe("99,5 JPY");
  });

  it("returns null for no price (nullpill case)", () => {
    expect(
      formatPrice({
        priceType: "none",
        priceMin: null,
        priceMax: null,
        currency: "USD",
      }),
    ).toBeNull();
  });

  it("returns null for an incomplete range", () => {
    expect(
      formatPrice({
        priceType: "range",
        priceMin: "10",
        priceMax: null,
        currency: "USD",
      }),
    ).toBeNull();
  });
});
