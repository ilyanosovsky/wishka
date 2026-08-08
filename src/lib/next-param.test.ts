import { describe, expect, it } from "vitest";

import { loginHrefWithNext, sanitizeNextPath } from "./next-param";

describe("sanitizeNextPath", () => {
  it("keeps a same-origin relative path, with query and hash", () => {
    expect(sanitizeNextPath("/wishes/123")).toBe("/wishes/123");
    expect(sanitizeNextPath("/wishes/new?url=x&parsed=1")).toBe(
      "/wishes/new?url=x&parsed=1",
    );
    expect(sanitizeNextPath("/u/masha#top")).toBe("/u/masha#top");
  });

  it("falls back to / for empty or non-path input", () => {
    expect(sanitizeNextPath(undefined)).toBe("/");
    expect(sanitizeNextPath(null)).toBe("/");
    expect(sanitizeNextPath("")).toBe("/");
    expect(sanitizeNextPath("wishes")).toBe("/");
    expect(sanitizeNextPath("https://evil.com")).toBe("/");
  });

  it("rejects every open-redirect shape, including URL-parser tricks", () => {
    // Protocol-relative and absolute.
    expect(sanitizeNextPath("//evil.com")).toBe("/");
    expect(sanitizeNextPath("https://evil.com/path")).toBe("/");
    // Backslash is a slash to the WHATWG parser: "/\evil.com" -> evil.com.
    expect(sanitizeNextPath("/\\evil.com")).toBe("/");
    expect(sanitizeNextPath("/\\/evil.com")).toBe("/");
    // Control characters the parser strips before it parses.
    expect(sanitizeNextPath("/\t/evil.com")).toBe("/");
    expect(sanitizeNextPath("/\n/evil.com")).toBe("/");
    expect(sanitizeNextPath("/\r/evil.com")).toBe("/");
    expect(sanitizeNextPath("\t//evil.com")).toBe("/");
  });

  it("never resolves to an origin other than the throwaway one", () => {
    for (const payload of [
      "/\\evil.com",
      "//evil.com",
      "/\t/\\evil.com",
      "https://evil.com",
      "/%2F%2Fevil.com",
    ]) {
      const safe = sanitizeNextPath(payload);
      const resolved = new URL(safe, "https://wishka.app");
      expect(resolved.origin).toBe("https://wishka.app");
    }
  });
});

describe("loginHrefWithNext", () => {
  it("leaves /login bare for the default target", () => {
    expect(loginHrefWithNext("/")).toBe("/login");
    expect(loginHrefWithNext("//evil.com")).toBe("/login");
  });

  it("encodes a valid next path into the query", () => {
    expect(loginHrefWithNext("/wishes/1")).toBe("/login?next=%2Fwishes%2F1");
  });
});
