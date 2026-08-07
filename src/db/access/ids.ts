const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards uuid parameters that arrive from URLs: Postgres raises `22P02` on a
 * malformed uuid literal, and a bad link should read as "not found", not 500.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
