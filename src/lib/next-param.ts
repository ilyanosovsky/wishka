/**
 * Validates an internal redirect target carried in a `?next=` search param
 * (post-login return path, session-expired CTA, the /g/<token> claim route).
 * Only a same-origin relative path survives; anything else collapses to "/".
 *
 * Prefix checks alone are not enough: every consumer feeds the result to
 * `new URL()` or a `Location` header, and the WHATWG parser both treats `\`
 * as `/` in the authority ("/\evil.com" -> https://evil.com) and strips raw
 * tab/newline/CR before parsing. So we strip those control characters, reject
 * the authority-introducing prefixes, and then re-parse against a throwaway
 * origin — if the path resolves anywhere other than that origin, it escaped.
 */
export function sanitizeNextPath(
  next: string | string[] | null | undefined,
): string {
  // Next.js delivers a repeated `?next=` key as an array; take the first value
  // rather than calling string methods on an array (which would throw).
  const raw = Array.isArray(next) ? next[0] : next;
  if (!raw) return "/";
  // The URL parser discards C0 controls + DEL; strip them so none can hide a
  // "//" or "/\" that would only surface after parsing.
  const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, "");
  if (
    !cleaned.startsWith("/") ||
    cleaned.startsWith("//") ||
    cleaned.startsWith("/\\")
  ) {
    return "/";
  }
  try {
    const url = new URL(cleaned, "https://wishka.invalid");
    if (url.origin !== "https://wishka.invalid") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** Appends a validated `?next=` to `/login` (or leaves it bare for "/"). */
export function loginHrefWithNext(
  next: string | string[] | null | undefined,
): string {
  const target = sanitizeNextPath(next);
  return target === "/"
    ? "/login"
    : `/login?next=${encodeURIComponent(target)}`;
}
