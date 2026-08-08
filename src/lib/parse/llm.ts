import "server-only";

import OpenAI from "openai";

import { detectCurrency, normalizeAmount } from "./price";
import type { ParseFields } from "./types";

/**
 * The only AI touchpoint of the parsing pipeline, behind an interface so the
 * pipeline can be tested without a network or an API key.
 *
 * Model name comes from `OPENAI_MODEL_TEXT` and nowhere else — OpenAI retires
 * models through 2026 (CLAUDE.md invariant #4), so swapping must be an env
 * change, never a code change.
 */
export interface LlmExtractor {
  /** Never throws: an unusable answer comes back as an empty object. */
  extract(text: string): Promise<Partial<ParseFields>>;
}

const SYSTEM_PROMPT = [
  "You extract product information from the text of a shop page.",
  "Return only what the page states. Use null for anything absent.",
  "Never invent or estimate a price, and never guess a currency.",
  "description: one short plain-text paragraph, at most 300 characters,",
  "no markdown, no marketing slogans, in the language of the page.",
  "price_min/price_max: digits only (dot decimal). Use price_max only when",
  "the page shows a range; otherwise leave it null.",
].join(" ");

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // Strict structured outputs require every property to be listed as required;
  // "absent" is expressed as an explicit null.
  required: [
    "title",
    "description",
    "image_url",
    "price_min",
    "price_max",
    "currency",
  ],
  properties: {
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    image_url: { type: ["string", "null"] },
    price_min: { type: ["string", "null"] },
    price_max: { type: ["string", "null"] },
    currency: {
      type: ["string", "null"],
      description: "ISO 4217 code, uppercase",
    },
  },
} as const;

const DESCRIPTION_MAX = 300;
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * GPT-5-class reasoning models bill their internal reasoning tokens against
 * `max_completion_tokens`, so a tight cap can be spent entirely on reasoning
 * and truncate the JSON body — which parses as `{}` and silently drops every
 * field. 1500 leaves ample room for reasoning plus our small strict payload.
 */
const MAX_OUTPUT_TOKENS = 1_500;

type RawExtraction = {
  title?: unknown;
  description?: unknown;
  image_url?: unknown;
  price_min?: unknown;
  price_max?: unknown;
  currency?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Exported for tests: the model's answer is untrusted input like any other. */
export function toFields(raw: unknown): Partial<ParseFields> {
  if (!raw || typeof raw !== "object") return {};
  const data = raw as RawExtraction;

  const description = text(data.description);
  const image = text(data.image_url);
  const currency =
    detectCurrency(text(data.currency)) ??
    detectCurrency(text(data.price_min)) ??
    null;

  const fields: Partial<ParseFields> = {};
  const title = text(data.title);
  if (title) fields.title = title;
  if (description) fields.description = description.slice(0, DESCRIPTION_MAX);
  // A model may echo a relative path; only an absolute http(s) URL is usable.
  if (image && /^https?:\/\//i.test(image)) fields.imageUrl = image;

  const priceMin = normalizeAmount(data.price_min);
  const priceMax = normalizeAmount(data.price_max);
  if (priceMin) fields.priceMin = priceMin;
  // A range needs both ends, and the top end must not sit below the bottom.
  if (priceMin && priceMax && Number(priceMax) > Number(priceMin)) {
    fields.priceMax = priceMax;
  }
  if (currency && (priceMin || priceMax)) fields.currency = currency;

  return fields;
}

/** Returns null when the app runs without an OpenAI key — the pipeline then
 *  simply skips every LLM layer instead of failing. */
export function createOpenAiExtractor(): LlmExtractor | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL_TEXT;
  if (!model) throw new Error("OPENAI_MODEL_TEXT is not set");

  const client = new OpenAI({ apiKey, maxRetries: 1 });

  return {
    async extract(content) {
      const completion = await client.chat.completions.create(
        {
          model,
          // No temperature override: GPT-5-family models (our default
          // gpt-5.6-luna) reject any non-default value. Extraction is
          // constrained by the strict json_schema anyway.
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "product_fields",
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content },
          ],
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      const answer = completion.choices[0]?.message?.content;
      if (!answer) return {};
      try {
        return toFields(JSON.parse(answer));
      } catch {
        return {};
      }
    },
  };
}
