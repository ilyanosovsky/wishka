// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const completionsMock = vi.fn();
const imagesMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: completionsMock } };
    images = { generate: imagesMock };
  },
}));

import type { AiPrompt } from "./prompts";
import {
  createOpenAiImageClient,
  createOpenAiTextClient,
  isAiAvailable,
} from "./client";

const PROMPT: AiPrompt = {
  system: "You are a static system prompt.",
  user: "ваза за 200 лари",
  schema: { type: "object", additionalProperties: false },
  name: "wish_draft",
};

/** A 1x1 PNG, base64 — enough to prove the decode path. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

afterEach(() => {
  vi.unstubAllEnvs();
  completionsMock.mockReset();
  imagesMock.mockReset();
});

describe("isAiAvailable", () => {
  it("follows the API key alone", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isAiAvailable()).toBe(false);
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(isAiAvailable()).toBe(true);
  });
});

describe("createOpenAiTextClient", () => {
  it("returns null without an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(createOpenAiTextClient()).toBeNull();
  });

  it("throws when the model env var is unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "");
    expect(() => createOpenAiTextClient()).toThrow(/OPENAI_MODEL_TEXT/);
  });

  it("sends a strict json_schema request with NO temperature", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "gpt-5.6-luna");
    completionsMock.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ title: "Ваза" }) } }],
    });

    const client = createOpenAiTextClient();
    expect(await client!.complete(PROMPT)).toEqual({ title: "Ваза" });

    const [payload, options] = completionsMock.mock.calls[0];
    expect(payload).not.toHaveProperty("temperature");
    // Invariant #4: the model name is env-driven, never a literal in code.
    expect(payload.model).toBe("gpt-5.6-luna");
    expect(payload.max_completion_tokens).toBeGreaterThanOrEqual(1_500);
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(payload.response_format.json_schema.name).toBe("wish_draft");
    expect(payload.response_format.json_schema.schema).toBe(PROMPT.schema);
    expect(options.timeout).toBe(15_000);
  });

  it("keeps the user's text in the user message only", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "gpt-5.6-luna");
    completionsMock.mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
    });

    await createOpenAiTextClient()!.complete(PROMPT);
    const [payload] = completionsMock.mock.calls[0];
    expect(payload.messages).toEqual([
      { role: "system", content: PROMPT.system },
      { role: "user", content: PROMPT.user },
    ]);
  });

  it("returns null when the answer is empty or not JSON", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "gpt-5.6-luna");

    completionsMock.mockResolvedValue({ choices: [{ message: {} }] });
    expect(await createOpenAiTextClient()!.complete(PROMPT)).toBeNull();

    completionsMock.mockResolvedValue({
      choices: [{ message: { content: "truncated{" } }],
    });
    expect(await createOpenAiTextClient()!.complete(PROMPT)).toBeNull();
  });

  it("returns null when the request rejects (network/429/5xx/timeout)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "gpt-5.6-luna");
    completionsMock.mockRejectedValue(new Error("429 Too Many Requests"));

    // Must not propagate: a thrown action is a stuck spinner in the form.
    expect(await createOpenAiTextClient()!.complete(PROMPT)).toBeNull();
  });
});

describe("createOpenAiImageClient", () => {
  it("returns null without an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(createOpenAiImageClient()).toBeNull();
  });

  it("throws when the model env var is unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_IMAGE", "");
    expect(() => createOpenAiImageClient()).toThrow(/OPENAI_MODEL_IMAGE/);
  });

  it("asks for one cheap 1024px image and decodes the base64 answer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_IMAGE", "gpt-image-2");
    imagesMock.mockResolvedValue({ data: [{ b64_json: PNG_B64 }] });

    const bytes = await createOpenAiImageClient()!.generate("a vase");
    expect(bytes).toBeInstanceOf(Uint8Array);
    // PNG magic bytes — the decode really produced the picture.
    expect(Array.from(bytes!.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const [payload, options] = imagesMock.mock.calls[0];
    expect(payload).not.toHaveProperty("temperature");
    expect(payload.model).toBe("gpt-image-2");
    expect(payload.prompt).toBe("a vase");
    expect(payload.size).toBe("1024x1024");
    expect(payload.quality).toBe("low");
    expect(options.timeout).toBe(60_000);
  });

  it("treats a URL-only answer as a failure (never re-fetches it)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_IMAGE", "gpt-image-2");
    imagesMock.mockResolvedValue({
      data: [{ url: "https://oaidalleapi.example/img.png" }],
    });

    // Invariant #6: a foreign URL must never reach storage or a wish row.
    expect(await createOpenAiImageClient()!.generate("a vase")).toBeNull();
  });

  it("returns null for an empty, missing or undecodable payload", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_IMAGE", "gpt-image-2");

    imagesMock.mockResolvedValue({ data: [] });
    expect(await createOpenAiImageClient()!.generate("x")).toBeNull();

    imagesMock.mockResolvedValue({});
    expect(await createOpenAiImageClient()!.generate("x")).toBeNull();

    imagesMock.mockResolvedValue({ data: [{ b64_json: "" }] });
    expect(await createOpenAiImageClient()!.generate("x")).toBeNull();
  });

  it("returns null when the request rejects", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_IMAGE", "gpt-image-2");
    imagesMock.mockRejectedValue(new Error("500 Internal Server Error"));

    expect(await createOpenAiImageClient()!.generate("x")).toBeNull();
  });
});
