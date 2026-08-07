/**
 * Postgres reports a unique violation as SQLSTATE 23505. Drizzle wraps driver
 * errors, so walk the cause chain instead of inspecting only the top error.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    current = candidate.cause;
  }
  return false;
}
