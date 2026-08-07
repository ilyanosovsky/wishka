export const NICKNAME_RE = /^[a-z0-9-]{3,30}$/;

/** Derive a base nickname candidate from email/name ("Ilya N." → "ilya-n"). */
export function sanitizeNickname(source: string): string {
  return source
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .padEnd(3, "0");
}
