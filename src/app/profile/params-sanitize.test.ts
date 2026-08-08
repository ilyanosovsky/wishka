import { describe, expect, it } from "vitest";
import { sanitizePublicParams } from "./params-sanitize";

describe("sanitizePublicParams", () => {
  it("trims strings and drops empty entries", () => {
    const result = sanitizePublicParams({
      sizes: { clothing: "  M  ", shoes: "   ", "": "42" },
      tastes: ["  coffee  ", "", "   "],
      noGift: ["socks", "  "],
    });

    expect(result).toEqual({
      sizes: { clothing: "M" },
      tastes: ["coffee"],
      noGift: ["socks"],
    });
  });

  it("dedupes list entries", () => {
    const result = sanitizePublicParams({
      sizes: {},
      tastes: ["tea", "tea", "Tea"],
      noGift: ["perfume", "perfume"],
    });

    // Case is preserved (not folded), so "tea" and "Tea" both survive —
    // only byte-identical duplicates are dropped.
    expect(result.tastes).toEqual(["tea", "Tea"]);
    expect(result.noGift).toEqual(["perfume"]);
  });

  it("caps each string at 80 characters", () => {
    const long = "x".repeat(200);
    const result = sanitizePublicParams({
      sizes: { clothing: long },
      tastes: [long],
      noGift: [long],
    });

    expect(result.sizes.clothing).toHaveLength(80);
    expect(result.tastes[0]).toHaveLength(80);
    expect(result.noGift[0]).toHaveLength(80);
  });

  it("caps tastes and noGift at 30 entries", () => {
    const many = Array.from({ length: 50 }, (_, i) => `taste-${i}`);
    const result = sanitizePublicParams({
      sizes: {},
      tastes: many,
      noGift: many.map((v) => `no-${v}`),
    });

    expect(result.tastes).toHaveLength(30);
    expect(result.noGift).toHaveLength(30);
  });

  it("caps the sizes object at 30 keys", () => {
    const sizes = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`key-${i}`, `value-${i}`]),
    );
    const result = sanitizePublicParams({ sizes, tastes: [], noGift: [] });

    expect(Object.keys(result.sizes)).toHaveLength(30);
  });

  it("keeps the four known size keys and tolerates custom ones", () => {
    const result = sanitizePublicParams({
      sizes: {
        clothing: "M",
        shoes: "42",
        ring: "17",
        head: "56",
        waist: "80",
      },
      tastes: [],
      noGift: [],
    });

    expect(result.sizes).toEqual({
      clothing: "M",
      shoes: "42",
      ring: "17",
      head: "56",
      waist: "80",
    });
  });

  it("lower-cases size keys so casing can't fork the same field", () => {
    const result = sanitizePublicParams({
      sizes: { Clothing: "M" },
      tastes: [],
      noGift: [],
    });

    expect(result.sizes).toEqual({ clothing: "M" });
  });

  it("returns empty defaults for missing/malformed input", () => {
    expect(
      sanitizePublicParams({
        sizes: {},
        tastes: [],
        noGift: [],
      }),
    ).toEqual({ sizes: {}, tastes: [], noGift: [] });
  });
});
