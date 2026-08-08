/**
 * The shape every parsing layer produces and the wish form consumes.
 *
 * Prices are `numeric`-compatible strings (dot decimal separator, no grouping)
 * because that is what the `wishes.price_min/price_max` columns take and what
 * `db/access/mutations.ts` validates — parsing must never hand the form a
 * locale-formatted string like "1 299,00".
 */
export type ParseFields = {
  title: string | null;
  description: string | null;
  /** After the server action ran, this is a URL on *our* CDN (invariant #6). */
  imageUrl: string | null;
  priceMin: string | null;
  priceMax: string | null;
  /** ISO 4217, uppercase. */
  currency: string | null;
};

/**
 * `ok` — enough to render a card without the user typing anything.
 * `partial` — a title and not much else; the form highlights the gaps.
 * `failed` — nothing usable; the UI falls through to manual entry, which is a
 * first-class path (product invariant #3), never an error state.
 */
export type ParseStatus = "ok" | "partial" | "failed";

/** Which layer of the pipeline produced the first usable field. */
export type ParseSource = "og" | "llm" | "jina" | "firecrawl";

export type PipelineResult = {
  status: ParseStatus;
  fields: ParseFields;
  source: ParseSource | null;
};

export const EMPTY_FIELDS: ParseFields = {
  title: null,
  description: null,
  imageUrl: null,
  priceMin: null,
  priceMax: null,
  currency: null,
};

/** Copies over only the keys the target still has as null. */
export function mergeFields(
  base: ParseFields,
  extra: Partial<ParseFields>,
): { fields: ParseFields; changed: boolean } {
  const fields = { ...base };
  let changed = false;
  for (const key of Object.keys(fields) as (keyof ParseFields)[]) {
    const value = extra[key];
    if (fields[key] === null && typeof value === "string" && value !== "") {
      fields[key] = value;
      changed = true;
    }
  }
  return { fields, changed };
}
