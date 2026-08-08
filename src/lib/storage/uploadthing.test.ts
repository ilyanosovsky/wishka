// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { appHostFromToken, keyForHost } from "./uploadthing";

/** A real-shaped UploadThing token: base64 of `{ apiKey, appId, regions }`. */
function tokenFor(appId: string): string {
  return Buffer.from(
    JSON.stringify({ apiKey: "sk_test_x", appId, regions: ["sea1"] }),
  ).toString("base64");
}

describe("appHostFromToken", () => {
  it("derives <appId>.ufs.sh from a valid token", () => {
    expect(appHostFromToken(tokenFor("w017mt9g7y"))).toBe("w017mt9g7y.ufs.sh");
  });

  it("returns null for a missing or malformed token", () => {
    expect(appHostFromToken(undefined)).toBeNull();
    expect(appHostFromToken("")).toBeNull();
    expect(appHostFromToken("not-base64-json")).toBeNull();
    expect(appHostFromToken(Buffer.from("{}").toString("base64"))).toBeNull();
  });
});

describe("keyForHost — exact host match (invariant #6)", () => {
  const OUR = "w017mt9g7y.ufs.sh";

  it("accepts our exact app host", () => {
    expect(keyForHost(`https://${OUR}/f/abc123`, OUR)).toBe("abc123");
  });

  it("accepts the legacy utfs.io host", () => {
    expect(keyForHost("https://utfs.io/f/abc123", OUR)).toBe("abc123");
  });

  it("REJECTS a foreign *.ufs.sh app (the reported bypass)", () => {
    expect(keyForHost("https://attacker-app.ufs.sh/f/abc123", OUR)).toBeNull();
    expect(keyForHost("https://w017mt9g7y.evil.com/f/abc123", OUR)).toBeNull();
  });

  it("rejects a wrong path shape on our host", () => {
    expect(keyForHost(`https://${OUR}/other/abc123`, OUR)).toBeNull();
    expect(keyForHost(`https://${OUR}/f/a/b`, OUR)).toBeNull();
  });

  it("rejects an ordinary shop CDN", () => {
    expect(
      keyForHost("https://cdn.some-shop.com/img/vase.jpg", OUR),
    ).toBeNull();
  });

  it("falls back to any *.ufs.sh when the app host is unknown (dev/CI)", () => {
    // This is the path mutations.test.ts (no token) relies on.
    expect(keyForHost("https://app123.ufs.sh/f/abc123", null)).toBe("abc123");
    expect(keyForHost("https://utfs.io/f/abc123", null)).toBe("abc123");
    expect(keyForHost("https://cdn.some-shop.com/x.jpg", null)).toBeNull();
  });

  it("returns null for non-URL input", () => {
    expect(keyForHost("not a url", OUR)).toBeNull();
  });
});
