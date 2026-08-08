import "server-only";

import OpenAI from "openai";

import type { AiPrompt } from "./prompts";

/**
 * The two AI touchpoints of Phase 6, behind interfaces so every caller — and
 * every test — can run without a network or an API key.
 *
 * Model names come from `OPENAI_MODEL_TEXT` / `OPENAI_MODEL_IMAGE` and nowhere
 * else (CLAUDE.md invariant #4): OpenAI retires models through 2026, so a swap
 * must be an env change, never a code change.
 *
 * Neither client ever throws. An AI assist is a bonus on top of a form that
 * works without it (invariant #3), so a rejected request, a timeout or an
 * unusable answer all come back as `null` and the caller renders a notice.
 */

/** Whether the app is configured for AI at all. Pages call this to decide
 *  whether to render AI affordances; the actions guard again regardless.
 *  Requires all three env vars, not just the API key — the client factories
 *  below throw if `OPENAI_MODEL_TEXT`/`OPENAI_MODEL_IMAGE` are missing, so a
 *  visible affordance backed by only the key would error forever instead of
 *  degrading to hidden. */
export function isAiAvailable(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_MODEL_TEXT &&
    process.env.OPENAI_MODEL_IMAGE,
  );
}

export interface AiTextClient {
  /** Parsed JSON matching the prompt's schema, or null on any failure. */
  complete(prompt: AiPrompt): Promise<unknown | null>;
}

export interface AiImageClient {
  /** PNG bytes, or null on any failure. */
  generate(prompt: string): Promise<Uint8Array | null>;
}

const TEXT_TIMEOUT_MS = 15_000;
/** Image generation is slow by nature; this is the whole round-trip budget,
 *  which is fine because the job runs inside `after()`, post-response. */
const IMAGE_TIMEOUT_MS = 60_000;

/**
 * GPT-5-class reasoning models bill their internal reasoning tokens against
 * `max_completion_tokens`, so a tight cap can be spent entirely on reasoning
 * and truncate the JSON body — which then parses as nothing at all. 1500
 * leaves ample room for reasoning plus our small strict payload.
 */
const MAX_OUTPUT_TOKENS = 1_500;

/**
 * The decoded cap `image-job.ts` enforces before anything is uploaded, mirrored
 * here as a cap on the *encoded* answer: base64 inflates bytes by 4/3, so a
 * longer string cannot possibly decode to an acceptable picture, and refusing
 * it up front avoids materialising a multi-megabyte Buffer we would then throw
 * away. The slack covers padding and any line breaks in the payload.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_B64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1_024;

const IMAGE_SIZE = "1024x1024";
/** Cheapest tier: a wishlist card renders the picture at ~320px anyway. */
const IMAGE_QUALITY = "low";

/** Null when the app runs without an OpenAI key — callers then answer
 *  `unavailable` and hide the affordance. Mirrors `createOpenAiExtractor`. */
export function createOpenAiTextClient(): AiTextClient | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL_TEXT;
  if (!model) throw new Error("OPENAI_MODEL_TEXT is not set");

  const client = new OpenAI({ apiKey, maxRetries: 1 });

  return {
    async complete(prompt) {
      try {
        const completion = await client.chat.completions.create(
          {
            model,
            // No temperature override: GPT-5-family models (our default
            // gpt-5.6-luna) reject any non-default value, and the strict
            // json_schema already constrains the shape of the answer.
            max_completion_tokens: MAX_OUTPUT_TOKENS,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: prompt.name,
                strict: true,
                schema: prompt.schema,
              },
            },
            messages: [
              { role: "system", content: prompt.system },
              // Everything the user typed lives here and only here.
              { role: "user", content: prompt.user },
            ],
          },
          { timeout: TEXT_TIMEOUT_MS },
        );

        const answer = completion.choices[0]?.message?.content;
        if (!answer) return null;
        return JSON.parse(answer);
      } catch {
        return null;
      }
    },
  };
}

export function createOpenAiImageClient(): AiImageClient | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL_IMAGE;
  if (!model) throw new Error("OPENAI_MODEL_IMAGE is not set");

  const client = new OpenAI({ apiKey, maxRetries: 1 });

  return {
    async generate(prompt) {
      try {
        const response = await client.images.generate(
          {
            model,
            prompt,
            size: IMAGE_SIZE,
            quality: IMAGE_QUALITY,
          },
          { timeout: IMAGE_TIMEOUT_MS },
        );

        // gpt-image-class models answer with base64 bytes. A URL-only answer
        // (older models, or a changed default) is treated as a failure rather
        // than re-fetched: handing a foreign URL to storage is exactly the
        // TOCTOU double-fetch invariant #6 forbids.
        const encoded = response.data?.[0]?.b64_json;
        if (typeof encoded !== "string" || !encoded) return null;
        if (encoded.length > MAX_IMAGE_B64_CHARS) return null;

        const bytes = Buffer.from(encoded, "base64");
        return bytes.byteLength > 0 ? new Uint8Array(bytes) : null;
      } catch {
        return null;
      }
    },
  };
}
