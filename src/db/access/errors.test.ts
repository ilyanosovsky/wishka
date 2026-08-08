// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isForeignKeyViolation, isUniqueViolation } from "./errors";

describe("SQLSTATE helpers", () => {
  describe("isForeignKeyViolation", () => {
    it("matches 23503 at the top level and nested down the cause chain", () => {
      expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
      expect(isForeignKeyViolation({ cause: { code: "23503" } })).toBe(true);
    });

    it("does not mistake a unique violation for one", () => {
      expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
      expect(isForeignKeyViolation({ cause: { code: "23505" } })).toBe(false);
    });
  });

  describe("isUniqueViolation", () => {
    it("matches 23505 at the top level and nested down the cause chain", () => {
      expect(isUniqueViolation({ code: "23505" })).toBe(true);
      expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
    });

    it("does not mistake a foreign-key violation for one", () => {
      expect(isUniqueViolation({ code: "23503" })).toBe(false);
      expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
    });
  });

  it("walks the cause chain up to five links deep, then gives up", () => {
    // Drizzle wraps driver errors, so the real code can sit several causes down.
    const nested = {
      cause: { cause: { cause: { cause: { code: "23503" } } } },
    };
    expect(isForeignKeyViolation(nested)).toBe(true);
    // A sixth link is out of reach and reads as no match.
    const tooDeep = { cause: nested };
    expect(isForeignKeyViolation(tooDeep)).toBe(false);
  });

  it("returns false for null and a plain Error with no SQLSTATE", () => {
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
});
