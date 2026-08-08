/** Drizzle wraps driver errors, so match SQLSTATE anywhere down the cause chain. */
function hasSqlState(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === code) return true;
    current = candidate.cause;
  }
  return false;
}

/** SQLSTATE 23505 — unique violation (the reservation race guard). */
export function isUniqueViolation(error: unknown): boolean {
  return hasSqlState(error, "23505");
}

/**
 * SQLSTATE 23503 — foreign-key violation. Raised when a wish is deleted in the
 * window between `reserveWish`'s visibility check and its insert, so it reads
 * as the wish being gone.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasSqlState(error, "23503");
}
