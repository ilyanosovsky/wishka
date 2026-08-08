// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isStoplisted } from "./stoplist";

describe("isStoplisted", () => {
  it.each([
    "https://www.amazon.com/dp/B08N5WRWNW",
    "https://amazon.com/dp/B08N5WRWNW",
    "https://www.amazon.de/dp/B08N5WRWNW",
    "https://amazon.co.uk/dp/B08N5WRWNW",
    "https://www.amazon.com.br/dp/B08N5WRWNW",
    "https://smile.amazon.co.jp/dp/B08N5WRWNW",
    "https://AMAZON.COM/dp/B08N5WRWNW",
  ])("stops %s", (url) => {
    expect(isStoplisted(url)).toBe(true);
  });

  it.each([
    // Lookalikes: the host merely contains "amazon".
    "https://myamazon.com/p/1",
    "https://www.myamazonstore.com/p/1",
    "https://amazonia.example/p/1",
    // A domain someone else controls, dressed up as Amazon.
    "https://amazon.phish.io/dp/B08N5WRWNW",
    "https://amazon.evil.example/dp/B08N5WRWNW",
    "https://amazon.com.attacker.net/dp/B08N5WRWNW",
    // Ordinary shops.
    "https://shop.example/products/vase",
  ])("does not stop %s", (url) => {
    expect(isStoplisted(url)).toBe(false);
  });

  it("returns false for something that is not a URL", () => {
    expect(isStoplisted("amazon")).toBe(false);
  });
});
