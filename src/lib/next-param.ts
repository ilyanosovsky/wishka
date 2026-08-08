/**
 * Validates an internal redirect target carried in a `?next=` search param
 * (post-login return path, session-expired CTA). Only same-origin relative
 * paths are accepted — anything else falls back to "/" so this can never be
 * turned into an open redirect.
 */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.includes("://")) return "/";
  return next;
}

/** Appends a validated `?next=` to `/login` (or leaves it bare for "/"). */
export function loginHrefWithNext(next: string): string {
  const target = sanitizeNextPath(next);
  return target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`;
}
