import { beforeEach, describe, expect, it } from "vitest";

import {
  RECENT_LISTS_KEY,
  RECENT_LISTS_MAX,
  normalizeRecentLists,
  readRecentLists,
  recordRecentList,
  upsertRecentList,
  type RecentList,
} from "./recent-lists";

function entry(nickname: string, at: number): RecentList {
  return { nickname, name: nickname, at };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("normalizeRecentLists", () => {
  it("returns an empty list for anything that is not an array", () => {
    expect(normalizeRecentLists(null)).toEqual([]);
    expect(normalizeRecentLists("nope")).toEqual([]);
    expect(normalizeRecentLists({ nickname: "ilya" })).toEqual([]);
  });

  it("drops malformed entries instead of throwing", () => {
    expect(
      normalizeRecentLists([
        { nickname: "ilya", name: "ilya", at: 3 },
        { nickname: "", name: "x", at: 1 },
        { nickname: "masha", name: "masha", at: "yesterday" },
        { nickname: "petya", at: 2 },
        42,
        null,
      ]),
    ).toEqual([{ nickname: "ilya", name: "ilya", at: 3 }]);
  });

  it("sorts newest first, dedupes by nickname and caps the length", () => {
    const stored = [
      entry("a", 1),
      entry("b", 5),
      entry("a", 9), // duplicate: the first occurrence wins
      ...Array.from({ length: 12 }, (_, i) => entry(`n${i}`, 100 + i)),
    ];

    const result = normalizeRecentLists(stored);

    expect(result).toHaveLength(RECENT_LISTS_MAX);
    expect(result.map((item) => item.nickname)).toEqual([
      "n11",
      "n10",
      "n9",
      "n8",
      "n7",
      "n6",
      "n5",
      "n4",
    ]);
  });
});

describe("upsertRecentList", () => {
  it("puts the visit at the front and removes the earlier one", () => {
    const result = upsertRecentList(
      [entry("masha", 2), entry("ilya", 1)],
      { nickname: "ilya", name: "Ilya" },
      10,
    );

    expect(result).toEqual([
      { nickname: "ilya", name: "Ilya", at: 10 },
      { nickname: "masha", name: "masha", at: 2 },
    ]);
  });

  it("trims the nickname and ignores an empty one", () => {
    expect(
      upsertRecentList([], { nickname: "  ilya ", name: "Ilya" }, 1),
    ).toEqual([{ nickname: "ilya", name: "Ilya", at: 1 }]);

    const existing = [entry("masha", 2)];
    expect(upsertRecentList(existing, { nickname: "   ", name: "" }, 1)).toBe(
      existing,
    );
  });

  it("never grows past the cap", () => {
    const full = Array.from({ length: RECENT_LISTS_MAX }, (_, i) =>
      entry(`n${i}`, i),
    );
    expect(
      upsertRecentList(full, { nickname: "new", name: "new" }, 99),
    ).toHaveLength(RECENT_LISTS_MAX);
  });
});

describe("readRecentLists / recordRecentList", () => {
  it("reads an empty list when nothing is stored", () => {
    expect(readRecentLists()).toEqual([]);
  });

  it("survives a corrupted store", () => {
    window.localStorage.setItem(RECENT_LISTS_KEY, "{not json");
    expect(readRecentLists()).toEqual([]);
  });

  it("round-trips a recorded visit", () => {
    recordRecentList({ nickname: "ilya", name: "Ilya" }, 5);
    recordRecentList({ nickname: "masha", name: "Masha" }, 7);

    expect(readRecentLists()).toEqual([
      { nickname: "masha", name: "Masha", at: 7 },
      { nickname: "ilya", name: "Ilya", at: 5 },
    ]);
  });

  it("re-visiting a list moves it back to the front without duplicating", () => {
    recordRecentList({ nickname: "ilya", name: "Ilya" }, 5);
    recordRecentList({ nickname: "masha", name: "Masha" }, 7);
    recordRecentList({ nickname: "ilya", name: "Ilya" }, 9);

    expect(readRecentLists().map((item) => item.nickname)).toEqual([
      "ilya",
      "masha",
    ]);
  });
});
