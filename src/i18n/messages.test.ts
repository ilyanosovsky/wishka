import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";

/** Every i18n key must exist in both locales — no silent fallbacks. */

type Messages = { [key: string]: string | Messages };

function collectKeys(obj: Messages, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : collectKeys(value, path);
  });
}

function collectValues(obj: Messages): string[] {
  return Object.values(obj).flatMap((value) =>
    typeof value === "string" ? [value] : collectValues(value),
  );
}

describe("message catalogs", () => {
  it("ru and en contain exactly the same keys", () => {
    expect(collectKeys(ru).sort()).toEqual(collectKeys(en).sort());
  });

  it("no message is empty", () => {
    for (const catalog of [ru, en]) {
      for (const value of collectValues(catalog)) {
        expect(value.trim()).not.toBe("");
      }
    }
  });
});
