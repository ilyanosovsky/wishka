/** Fixed starter set; stored on wishes as the key string. AI suggestion
 *  (Phase 6) picks from this list too. Labels live in i18n: wish.category.* */
export const CATEGORY_KEYS = [
  "electronics",
  "clothes",
  "home",
  "hobby",
  "beauty",
  "sport",
  "books",
  "experiences",
  "services",
  "certificates",
  "other",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export function isCategoryKey(value: unknown): value is CategoryKey {
  return (
    typeof value === "string" &&
    (CATEGORY_KEYS as readonly string[]).includes(value)
  );
}
