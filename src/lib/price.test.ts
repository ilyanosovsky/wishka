import { describe, expect, it } from "vitest";
import { formatPrice } from "./price";

describe("formatPrice", () => {
  const NBSP = "\u00a0";

  it("formats an exact price with a known symbol", () => {
    expect(
      formatPrice(
        {
          priceType: "exact",
          priceMin: "1400",
          priceMax: null,
          currency: "USD",
        },
        "ru",
      ),
    ).toBe(`1${NBSP}400 $`);
  });

  it("formats a range with the lari symbol", () => {
    expect(
      formatPrice(
        {
          priceType: "range",
          priceMin: "2000",
          priceMax: "3000",
          currency: "GEL",
        },
        "ru",
      ),
    ).toBe(`2${NBSP}000–3${NBSP}000 ₾`);
  });

  it("falls back to the currency code when the symbol is unknown", () => {
    expect(
      formatPrice(
        {
          priceType: "exact",
          priceMin: "99.5",
          priceMax: null,
          currency: "JPY",
        },
        "ru",
      ),
    ).toBe("99,5 JPY");
  });

  it("returns null for no price (nullpill case)", () => {
    expect(
      formatPrice(
        {
          priceType: "none",
          priceMin: null,
          priceMax: null,
          currency: "USD",
        },
        "ru",
      ),
    ).toBeNull();
  });

  it("returns null for an incomplete range", () => {
    expect(
      formatPrice(
        {
          priceType: "range",
          priceMin: "10",
          priceMax: null,
          currency: "USD",
        },
        "ru",
      ),
    ).toBeNull();
  });

  // Invariant #7: an EN viewer must not get Russian grouping/decimals.
  describe("locale", () => {
    it("groups with a comma and dots the decimal in en", () => {
      expect(
        formatPrice(
          {
            priceType: "exact",
            priceMin: "1400.5",
            priceMax: null,
            currency: "USD",
          },
          "en",
        ),
      ).toBe("1,400.5 $");
    });

    it("groups with a nbsp and commas the decimal in ru", () => {
      expect(
        formatPrice(
          {
            priceType: "exact",
            priceMin: "1400.5",
            priceMax: null,
            currency: "USD",
          },
          "ru",
        ),
      ).toBe(`1${NBSP}400,5 $`);
    });

    it("formats both ends of a range in the given locale", () => {
      expect(
        formatPrice(
          {
            priceType: "range",
            priceMin: "2000",
            priceMax: "3000",
            currency: "GEL",
          },
          "en",
        ),
      ).toBe("2,000–3,000 ₾");
    });
  });
});
