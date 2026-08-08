// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import sax from "sax";
import { describe, expect, it } from "vitest";

/**
 * Next's file conventions turn `src/app/icon.svg`, `favicon.ico` and
 * `apple-icon.png` into the app's only branding assets — and nothing in the
 * build validates them.
 *
 * Phase 9 shipped an `icon.svg` whose comment contained `--`, which XML
 * forbids. Browsers parse `image/svg+xml` with a strict XML parser, so the
 * file was a parse error rather than an icon and every tab rendered blank.
 * `happy-dom`'s DOMParser does not model that rule (it accepts the malformed
 * comment), hence `sax` in strict mode, which does.
 */

const APP_DIR = path.resolve(process.cwd(), "src/app");

/** Collects strict-XML violations instead of stopping at the first one, so a
 *  failure names everything wrong with the file at once. */
function xmlErrors(source: string): string[] {
  const errors: string[] = [];
  const parser = sax.parser(true);
  parser.onerror = (error) => {
    errors.push(error.message.split("\n")[0]);
    // `resume()` clears the error flag so parsing continues past it.
    parser.resume();
  };
  parser.write(source).close();
  return errors;
}

describe("app icon assets", () => {
  it("parses every src/app/*.svg as well-formed XML", async () => {
    const names = (await readdir(APP_DIR)).filter((name) =>
      name.endsWith(".svg"),
    );
    // A missing icon.svg is itself the regression this guards.
    expect(names).toContain("icon.svg");

    for (const name of names) {
      const source = await readFile(path.join(APP_DIR, name), "utf8");
      expect(xmlErrors(source), `${name} is not well-formed XML`).toEqual([]);
    }
  });

  it("catches the malformed comment that shipped in Phase 9", () => {
    expect(
      xmlErrors('<svg xmlns="http://www.w3.org/2000/svg"><!-- --bg --></svg>'),
    ).not.toEqual([]);
  });

  it("keeps a real favicon.ico for clients that only probe /favicon.ico", async () => {
    const ico = await readFile(path.join(APP_DIR, "favicon.ico"));
    // ICONDIR: reserved 0, type 1 (icon), then the image count.
    expect(ico.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
    expect(ico.byteLength).toBeGreaterThan(1000);
  });

  it("keeps an apple-icon.png for iOS home-screen saves", async () => {
    const png = await readFile(path.join(APP_DIR, "apple-icon.png"));
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    // IHDR width/height live at byte 16..24 — Apple's touch icon is 180×180.
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });
});
