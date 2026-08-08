/**
 * Pure sanitizer for `updatePublicParams` (see ./actions.ts). Extracted so it
 * is unit-testable without mocking the DB/session — a "use server" file may
 * only export async functions, so this logic can't live there directly.
 *
 * This data renders on the public `/u/<nickname>` profile, so the caps here
 * are defensive: nothing a client sends should be able to grow the `sizes`/
 * `tastes`/`noGift` jsonb columns into an unbounded blob.
 */

/** The four size rows the editor renders today (§6.6). Any other key is
 *  treated as a "custom parameter" — the add-custom-parameter UI is
 *  deferred (see Phase 7a report), but the sanitizer already tolerates
 *  arbitrary keys under the same caps so a future UI needs no data-layer
 *  change. */
export const KNOWN_SIZE_KEYS = ["clothing", "shoes", "ring", "head"] as const;
export type KnownSizeKey = (typeof KNOWN_SIZE_KEYS)[number];

export type PublicParamsInput = {
  sizes: Record<string, string>;
  tastes: string[];
  noGift: string[];
};

const MAX_LIST_LENGTH = 30;
const MAX_STRING_LENGTH = 80;

function capString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_STRING_LENGTH);
}

/** Trims, drops empties, dedupes, and caps at `MAX_LIST_LENGTH` entries. */
function sanitizeList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const value = capString(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_LIST_LENGTH) break;
  }
  return out;
}

/** Same trim/empty-drop/length-cap/count-cap rules as `sanitizeList`, keyed
 *  instead of listed. Keys are lower-cased so "Clothing" and "clothing"
 *  can't both land in the object. */
function sanitizeSizes(sizes: unknown): Record<string, string> {
  if (!sizes || typeof sizes !== "object") return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(
    sizes as Record<string, unknown>,
  )) {
    if (count >= MAX_LIST_LENGTH) break;
    const key = capString(rawKey).toLowerCase();
    const value = capString(rawValue);
    if (!key || !value) continue;
    out[key] = value;
    count += 1;
  }
  return out;
}

export function sanitizePublicParams(
  input: PublicParamsInput,
): PublicParamsInput {
  return {
    sizes: sanitizeSizes(input.sizes),
    tastes: sanitizeList(input.tastes),
    noGift: sanitizeList(input.noGift),
  };
}
