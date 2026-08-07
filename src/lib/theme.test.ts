import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, THEME_STORAGE_KEY } from "./theme";

describe("getStoredTheme", () => {
  it("returns a valid stored theme", () => {
    expect(getStoredTheme({ getItem: () => "dark" })).toBe("dark");
  });

  it.each([null, "", "banana", "DARK"])(
    "falls back to system for %j",
    (raw) => {
      expect(getStoredTheme({ getItem: () => raw as string | null })).toBe(
        "system",
      );
    },
  );
});

describe("applyTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("persists the choice and stamps <html data-theme>", () => {
    applyTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
