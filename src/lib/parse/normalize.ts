import { createHash } from "node:crypto";

/**
 * URL canonicalisation for the parsing pipeline.
 *
 * Two jobs: reject anything that is not a fetchable web page (`javascript:`,
 * `data:` and friends never reach the fetcher), and make "the same product"
 * hash to the same key so `parsed_url_cache` is shared across users instead of
 * storing one row per campaign link.
 */

/** Prefix-matched tracking parameters. */
const TRACKING_PREFIXES = ["utm_", "ref_"];
/** Exact-match tracking parameters (click ids). */
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "yclid"]);

function isTracking(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    TRACKING_PARAMS.has(lower) ||
    TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/** "shop.com/x" pasted without a scheme — a host-looking string, no spaces. */
const BARE_HOST_RE = /^[\w-]+(\.[\w-]+)+(?=$|[/?#])/;

function toUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    // Only retry as https when the input actually starts with a hostname:
    // "mailto:a@b" already parsed above and must stay rejected.
    if (!BARE_HOST_RE.test(raw)) return null;
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

/**
 * Returns the canonical URL string, or null when the input is not an http(s)
 * page. The scheme is preserved: silently upgrading http → https would break
 * the (few) shops that still serve plain http.
 */
export function normalizeUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const url = toUrl(trimmed);
  if (!url) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || !url.hostname.includes(".")) return null;

  // Hostnames are case-insensitive; `URL` already lowercases them. A trailing
  // root dot ("shop.com.") is legal DNS but never what the user meant.
  url.hostname = url.hostname.replace(/\.$/, "");
  url.hash = "";
  url.username = "";
  url.password = "";

  for (const name of [...url.searchParams.keys()]) {
    if (isTracking(name)) url.searchParams.delete(name);
  }
  // Drop a now-empty "?" so ".../item" and ".../item?utm_source=x" agree.
  if ([...url.searchParams.keys()].length === 0) url.search = "";

  return url.toString();
}

/** Cache key for `parsed_url_cache.url_hash`. Feed it a normalized URL. */
export function urlHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}
