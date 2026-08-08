// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import { createOpenAiExtractor, toFields } from "./llm";

describe("toFields", () => {
  it("reads a European-formatted price + currency", () => {
    expect(toFields({ price_min: "1.299,00", currency: "EUR" })).toMatchObject({
      priceMin: "1299.00",
      currency: "EUR",
    });
  });

  it("reads a US-formatted price", () => {
    expect(toFields({ price_min: "1,299.00", currency: "USD" })).toMatchObject({
      priceMin: "1299.00",
      currency: "USD",
    });
  });

  it("rejects a relative or non-http image URL", () => {
    expect(
      toFields({ title: "X", image_url: "/images/rel.jpg" }).imageUrl,
    ).toBe(undefined);
    expect(
      toFields({ title: "X", image_url: "ftp://host/x.jpg" }).imageUrl,
    ).toBe(undefined);
  });

  it("keeps an absolute http(s) image URL", () => {
    expect(
      toFields({ title: "X", image_url: "https://cdn.example/x.jpg" }).imageUrl,
    ).toBe("https://cdn.example/x.jpg");
  });

  it("drops a currency when there is no price", () => {
    expect(toFields({ title: "X", currency: "EUR" }).currency).toBe(undefined);
  });

  it("drops price_max when it is not above price_min", () => {
    const fields = toFields({
      price_min: "100",
      price_max: "50",
      currency: "USD",
    });
    expect(fields.priceMin).toBe("100.00");
    expect(fields.priceMax).toBe(undefined);
  });

  it("keeps a valid range", () => {
    const fields = toFields({
      price_min: "100",
      price_max: "150",
      currency: "USD",
    });
    expect(fields.priceMin).toBe("100.00");
    expect(fields.priceMax).toBe("150.00");
  });

  it("clamps the description to 300 chars", () => {
    const fields = toFields({ title: "X", description: "a".repeat(400) });
    expect(fields.description).toHaveLength(300);
  });

  it("never invents a price from nothing", () => {
    expect(toFields({ title: "X", price_min: "free" }).priceMin).toBe(
      undefined,
    );
  });

  it.each([null, undefined, 42, "string", []])(
    "returns {} for non-object input %j",
    (raw) => {
      expect(toFields(raw)).toEqual({});
    },
  );
});

describe("createOpenAiExtractor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createMock.mockReset();
  });

  it("returns null without an API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(createOpenAiExtractor()).toBeNull();
  });

  it("throws when the model env var is unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "");
    expect(() => createOpenAiExtractor()).toThrow(/OPENAI_MODEL_TEXT/);
  });

  it("sends a strict json_schema request with NO temperature", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "gpt-5.6-luna");
    createMock.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ title: "Ceramic Vase" }) } },
      ],
    });

    const extractor = createOpenAiExtractor();
    expect(extractor).not.toBeNull();
    const fields = await extractor!.extract("page text");
    expect(fields.title).toBe("Ceramic Vase");

    const [payload, options] = createMock.mock.calls[0];
    expect(payload).not.toHaveProperty("temperature");
    expect(payload.model).toBe("gpt-5.6-luna");
    expect(payload.max_completion_tokens).toBeGreaterThanOrEqual(1000);
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema.strict).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("returns {} when the model answer is not valid JSON", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL_TEXT", "gpt-5.6-luna");
    createMock.mockResolvedValue({
      choices: [{ message: { content: "not json — truncated{" } }],
    });

    const extractor = createOpenAiExtractor();
    expect(await extractor!.extract("page text")).toEqual({});
  });
});
