// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appHostFromToken,
  keyForHost,
  resolveHostPolicy,
  type StorageHostPolicy,
} from "./uploadthing";

/** A real-shaped UploadThing token: base64 of `{ apiKey, appId, regions }`. */
function tokenFor(appId: string): string {
  return Buffer.from(
    JSON.stringify({ apiKey: "sk_test_x", appId, regions: ["sea1"] }),
  ).toString("base64");
}

const EXACT: StorageHostPolicy = { kind: "exact", host: "w017mt9g7y.ufs.sh" };
const LOOSE: StorageHostPolicy = { kind: "loose" };
const STRICT: StorageHostPolicy = { kind: "strict" };

describe("appHostFromToken", () => {
  it("derives <appId>.ufs.sh from a valid token", () => {
    expect(appHostFromToken(tokenFor("w017mt9g7y"))).toBe("w017mt9g7y.ufs.sh");
  });

  it("returns null for a malformed token", () => {
    expect(appHostFromToken("")).toBeNull();
    expect(appHostFromToken("not-base64-json")).toBeNull();
    expect(appHostFromToken(Buffer.from("{}").toString("base64"))).toBeNull();
  });
});

describe("resolveHostPolicy", () => {
  it("is loose only when NO token is configured (dev/CI)", () => {
    expect(resolveHostPolicy(undefined)).toEqual({ kind: "loose" });
    expect(resolveHostPolicy("")).toEqual({ kind: "loose" });
  });

  it("is exact for a valid token", () => {
    expect(resolveHostPolicy(tokenFor("w017mt9g7y"))).toEqual({
      kind: "exact",
      host: "w017mt9g7y.ufs.sh",
    });
  });

  it("is strict (fail closed) for a present-but-unparseable token", () => {
    // A prod misconfig must NOT fall open to any *.ufs.sh.
    expect(resolveHostPolicy("garbage-token")).toEqual({ kind: "strict" });
    expect(resolveHostPolicy(Buffer.from("{}").toString("base64"))).toEqual({
      kind: "strict",
    });
  });
});

describe("keyForHost — exact host match (invariant #6)", () => {
  const OUR = "w017mt9g7y.ufs.sh";

  it("accepts our exact app host", () => {
    expect(keyForHost(`https://${OUR}/f/abc123`, EXACT)).toBe("abc123");
  });

  it("accepts the legacy utfs.io host under every policy", () => {
    expect(keyForHost("https://utfs.io/f/abc123", EXACT)).toBe("abc123");
    expect(keyForHost("https://utfs.io/f/abc123", LOOSE)).toBe("abc123");
    expect(keyForHost("https://utfs.io/f/abc123", STRICT)).toBe("abc123");
  });

  it("REJECTS a foreign *.ufs.sh app (the reported bypass)", () => {
    expect(
      keyForHost("https://attacker-app.ufs.sh/f/abc123", EXACT),
    ).toBeNull();
    expect(
      keyForHost("https://w017mt9g7y.evil.com/f/abc123", EXACT),
    ).toBeNull();
  });

  it("rejects a wrong path shape on our host", () => {
    expect(keyForHost(`https://${OUR}/other/abc123`, EXACT)).toBeNull();
    expect(keyForHost(`https://${OUR}/f/a/b`, EXACT)).toBeNull();
  });

  it("rejects an ordinary shop CDN", () => {
    expect(
      keyForHost("https://cdn.some-shop.com/img/vase.jpg", EXACT),
    ).toBeNull();
  });

  it("loose: accepts any *.ufs.sh when no token is configured (dev/CI)", () => {
    // This is the path mutations.test.ts (no token) relies on.
    expect(keyForHost("https://app123.ufs.sh/f/abc123", LOOSE)).toBe("abc123");
    expect(keyForHost("https://cdn.some-shop.com/x.jpg", LOOSE)).toBeNull();
  });

  it("strict: rejects ALL *.ufs.sh on a malformed prod token (fail closed)", () => {
    expect(keyForHost("https://app123.ufs.sh/f/abc123", STRICT)).toBeNull();
    expect(keyForHost("https://w017mt9g7y.ufs.sh/f/abc123", STRICT)).toBeNull();
  });

  it("returns null for non-URL input", () => {
    expect(keyForHost("not a url", EXACT)).toBeNull();
  });
});
