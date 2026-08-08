import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast lock for the Paper Ledger palette.
 *
 * Every colour pair the UI actually paints is listed here with the WCAG
 * threshold it has to clear, in both themes. Change a token in tokens.css and
 * this test names the pair you broke — that is the whole point: the audit found
 * six AA failures that nothing in the build could have caught.
 *
 * Thresholds: 4.5 for text (there is no large text in this kit — the biggest
 * type on a coloured surface is the 21px group mark, still under the 24px/18.66px
 * bold large-text cutoff), 3.0 for icons and UI boundaries.
 */

// import.meta.url is an http:// URL under Vite, so the path comes off the
// vitest root instead.
const CSS = readFileSync(
  resolvePath(process.cwd(), "src/styles/tokens.css"),
  "utf8",
);

type Rgb = readonly [number, number, number];

function parseBlock(source: string, startIndex: number): Map<string, string> {
  const open = source.indexOf("{", startIndex);
  const end = source.indexOf("}", open);
  const tokens = new Map<string, string>();
  for (const line of source.slice(open + 1, end).split("\n")) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line);
    if (match) tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function blockAt(selector: string): Map<string, string> {
  const index = CSS.indexOf(selector);
  expect(index, `selector ${selector} missing from tokens.css`).toBeGreaterThan(
    -1,
  );
  return parseBlock(CSS, index);
}

const LIGHT = blockAt(":root {");
const DARK = blockAt('[data-theme="dark"] {');
const DARK_SYSTEM = blockAt(":root:not([data-theme]) {");

function toRgb(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : hex[1];
    return {
      rgb: [
        parseInt(digits.slice(0, 2), 16),
        parseInt(digits.slice(2, 4), 16),
        parseInt(digits.slice(4, 6), 16),
      ],
      alpha: 1,
    };
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => Number(part.trim()));
    return {
      rgb: [parts[0], parts[1], parts[2]],
      alpha: parts.length > 3 ? parts[3] : 1,
    };
  }
  throw new Error(`unsupported colour value: ${value}`);
}

function composite(over: Rgb, under: Rgb, alpha: number): Rgb {
  return [
    over[0] * alpha + under[0] * (1 - alpha),
    over[1] * alpha + under[1] * (1 - alpha),
    over[2] * alpha + under[2] * (1 - alpha),
  ];
}

/** Resolves a token to opaque RGB, compositing a translucent one over `under`. */
function resolve(theme: Map<string, string>, token: string, under: Rgb): Rgb {
  const raw = theme.get(token);
  if (raw === undefined) throw new Error(`token ${token} not defined`);
  const { rgb, alpha } = toRgb(raw);
  return alpha === 1 ? rgb : composite(rgb, under, alpha);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Pair = {
  /** foreground token */
  fg: string;
  /** background token */
  bg: string;
  /** surface a translucent background composites over (default --paper) */
  under?: string;
  min: number;
  where: string;
};

const TEXT = 4.5;
const UI = 3;

/** Text and icons. Every one of these is a live call site, not a hypothetical. */
const PAIRS: Pair[] = [
  // ── body text on the three surfaces ────────────────────────────────────
  { fg: "--ink", bg: "--bg", min: TEXT, where: "page copy" },
  { fg: "--ink", bg: "--paper", min: TEXT, where: "card copy" },
  { fg: "--ink", bg: "--zebra", min: TEXT, where: "zebra row copy" },
  { fg: "--mute", bg: "--bg", min: TEXT, where: "field labels, inactive tabs" },
  { fg: "--mute", bg: "--paper", min: TEXT, where: "field labels on paper" },
  { fg: "--mute", bg: "--zebra", min: TEXT, where: "share-link box" },
  {
    fg: "--mute-2",
    bg: "--bg",
    min: TEXT,
    where: "TabBar inactive nav labels + icons",
  },
  {
    fg: "--mute-2",
    bg: "--paper",
    min: TEXT,
    where: "placeholders, gifted meta",
  },
  {
    fg: "--mute-2",
    bg: "--zebra",
    min: TEXT,
    where: "parsed-link value (locked field)",
  },

  // ── ink and accent fills ───────────────────────────────────────────────
  { fg: "--paper", bg: "--ink", min: TEXT, where: "active tab, TabBar, toast" },
  { fg: "--paper", bg: "--accent", min: TEXT, where: "primary Button" },
  { fg: "--paper", bg: "--mute", min: TEXT, where: "group mark, mute swatch" },
  { fg: "--ink", bg: "--rule", min: TEXT, where: "group mark, rule swatch" },
  { fg: "--ink", bg: "--rule-2", min: TEXT, where: "group mark neighbours" },
  { fg: "--accent", bg: "--accent-soft", min: TEXT, where: "free StatusBadge" },
  { fg: "--accent-ink", bg: "--accent-soft", min: TEXT, where: "info banner" },
  { fg: "--accent", bg: "--paper", min: UI, where: "focus border on fields" },

  // ── NULL family ────────────────────────────────────────────────────────
  { fg: "--null-txt", bg: "--null", min: TEXT, where: "NullPill, warning" },
  {
    fg: "--null-txt",
    bg: "--paper",
    min: TEXT,
    where: "PriorityFlag «want», DreamStamp",
  },

  // ── semantic families on their own tint ────────────────────────────────
  { fg: "--neg", bg: "--red-soft", min: TEXT, where: "error AlertBanner" },
  { fg: "--red-txt", bg: "--red-soft", min: TEXT, where: "NoGiftChip" },
  {
    fg: "--neg",
    bg: "--paper",
    min: TEXT,
    where: "danger Button, field error",
  },
  { fg: "--green-txt", bg: "--green-soft", min: TEXT, where: "green badges" },
  { fg: "--blue-txt", bg: "--blue-soft", min: TEXT, where: "blue badges" },
  { fg: "--amber-txt", bg: "--amber-soft", min: TEXT, where: "amber badges" },
  { fg: "--ok", bg: "--ok-soft", min: TEXT, where: "ok badges" },

  // ── the toast bar is painted with --ink, in both themes ────────────────
  {
    fg: "--toast-accent",
    bg: "--ink",
    min: TEXT,
    where: "Undo link + drain bar",
  },

  // ── focus ring: 3:1 against every surface it can land on ───────────────
  { fg: "--focus-ring", bg: "--bg", min: UI, where: ":focus-visible on page" },
  {
    fg: "--focus-ring",
    bg: "--paper",
    min: UI,
    where: ":focus-visible on card",
  },
  {
    fg: "--focus-ring",
    bg: "--zebra",
    min: UI,
    where: ":focus-visible on row",
  },
  {
    fg: "--focus-ring",
    bg: "--ink",
    min: UI,
    where: ":focus-visible next to an ink fill",
  },
];

/**
 * Hairlines. WCAG 1.4.11 does not reach them — none of these boundaries
 * identifies an interactive control on its own (the fill and the label do) —
 * and the 1px ledger rule is the whole visual language. They are pinned at
 * their measured value so a regression still fails; raising one is free.
 */
const HAIRLINES: Pair[] = [
  { fg: "--rule", bg: "--paper", min: 1.03, where: "card/table hairline" },
  {
    fg: "--rule-2",
    bg: "--paper",
    min: 1.55,
    where: "field, chip, tab border",
  },
  { fg: "--rule-2", bg: "--bg", min: 1.44, where: "sheet border" },
  { fg: "--red-rule", bg: "--paper", min: 1.5, where: "danger Button border" },
  {
    fg: "--green-rule",
    bg: "--accent-soft",
    min: 1.38,
    where: "free StatusBadge border",
  },
  { fg: "--null-rule", bg: "--null", min: 1.75, where: "NullPill border" },
];

const THEMES: [string, Map<string, string>][] = [
  ["light", LIGHT],
  ["dark", DARK],
  ["dark (system)", DARK_SYSTEM],
];

function ratioFor(theme: Map<string, string>, pair: Pair): number {
  const under = resolve(theme, pair.under ?? "--paper", [255, 255, 255]);
  const bg = resolve(theme, pair.bg, under);
  const fg = resolve(theme, pair.fg, bg);
  return contrast(fg, bg);
}

describe("tokens.css — theme blocks", () => {
  it("keeps both dark blocks byte-identical (plain CSS has no mixins)", () => {
    expect(Object.fromEntries(DARK_SYSTEM)).toEqual(Object.fromEntries(DARK));
  });

  it("declares color-scheme so browser chrome follows the theme", () => {
    // The lookbehind keeps `@media (prefers-color-scheme: dark)` out of it.
    expect(CSS).toMatch(/(?<!-)color-scheme:\s*light/);
    expect(CSS.match(/(?<!-)color-scheme:\s*dark/g)).toHaveLength(2);
  });

  it("defines every token used by a pinned pair, in every theme", () => {
    const used = new Set(
      [...PAIRS, ...HAIRLINES].flatMap((pair) => [pair.fg, pair.bg]),
    );
    for (const [name, theme] of THEMES) {
      for (const token of used) {
        expect(theme.has(token), `${token} missing in ${name}`).toBe(true);
      }
    }
  });
});

describe.each(THEMES)("WCAG contrast — %s theme", (_name, theme) => {
  it.each(PAIRS)(
    "$fg on $bg ≥ $min ($where)",
    ({ fg, bg, under, min, where }) => {
      const ratio = ratioFor(theme, { fg, bg, under, min, where });
      expect(
        Number(ratio.toFixed(2)),
        `${fg} on ${bg} — ${where}`,
      ).toBeGreaterThanOrEqual(min);
    },
  );

  it.each(HAIRLINES)(
    "hairline $fg on $bg holds at ≥ $min ($where)",
    ({ fg, bg, under, min, where }) => {
      const ratio = ratioFor(theme, { fg, bg, under, min, where });
      expect(
        Number(ratio.toFixed(2)),
        `${fg} on ${bg} — ${where}`,
      ).toBeGreaterThanOrEqual(min);
    },
  );
});
