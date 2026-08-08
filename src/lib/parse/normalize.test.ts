// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeUrl, urlHash } from "./normalize";

describe("normalizeUrl", () => {
  it("keeps an ordinary product URL intact", () => {
    expect(normalizeUrl("https://shop.example/products/vase")).toBe(
      "https://shop.example/products/vase",
    );
  });

  it("strips tracking parameters but keeps meaningful ones", () => {
    expect(
      normalizeUrl(
        "https://shop.example/p/vase?variant=42&utm_source=newsletter&utm_medium=email&fbclid=abc&gclid=def&yclid=ghi&ref_src=twitter",
      ),
    ).toBe("https://shop.example/p/vase?variant=42");
  });

  it("drops the query entirely when only tracking was there", () => {
    expect(
      normalizeUrl("https://shop.example/p/vase?utm_campaign=spring"),
    ).toBe("https://shop.example/p/vase");
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://shop.example/p/vase#reviews")).toBe(
      "https://shop.example/p/vase",
    );
  });

  it("lowercases the host and drops the root dot", () => {
    expect(normalizeUrl("https://Shop.EXAMPLE./p/Vase")).toBe(
      "https://shop.example/p/Vase",
    );
  });

  it("strips embedded credentials", () => {
    expect(normalizeUrl("https://user:pw@shop.example/p/vase")).toBe(
      "https://shop.example/p/vase",
    );
  });

  it("keeps http as http", () => {
    expect(normalizeUrl("http://shop.example/p/vase")).toBe(
      "http://shop.example/p/vase",
    );
  });

  it("accepts a scheme-less host and assumes https", () => {
    expect(normalizeUrl("shop.example/p/vase")).toBe(
      "https://shop.example/p/vase",
    );
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "mailto:someone@example.com",
    "ftp://files.example/thing",
    "file:///etc/passwd",
  ])("rejects %s", (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });

  it.each(["", "   ", "not a url", "https://", "localhost:3000/x"])(
    "rejects garbage input %j",
    (input) => {
      expect(normalizeUrl(input)).toBeNull();
    },
  );

  it("collapses campaign variants of one product to one cache key", () => {
    const a = normalizeUrl("https://shop.example/p/vase?utm_source=a")!;
    const b = normalizeUrl("https://shop.example/p/vase#gallery")!;
    expect(urlHash(a)).toBe(urlHash(b));
  });

  it("hashes different URLs differently, as 64 hex chars", () => {
    const hash = urlHash("https://shop.example/p/vase");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(urlHash("https://shop.example/p/mug"));
  });
});
