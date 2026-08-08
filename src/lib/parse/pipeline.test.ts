// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { LlmExtractor } from "./llm";
import { cleanHtml, runPipeline, type PipelineDeps } from "./pipeline";
import type { ParseFields } from "./types";

const FIXTURES = path.join(import.meta.dirname, "__fixtures__");
const URL_UNDER_TEST = "https://clay-and-co.example/products/vase";

let shopifyLike: string;
let challenge: string;
let emptyShell: string;

beforeAll(async () => {
  [shopifyLike, challenge, emptyShell] = await Promise.all(
    ["shopify-like.html", "challenge.html", "empty-shell.html"].map((name) =>
      readFile(path.join(FIXTURES, name), "utf8"),
    ),
  );
});

/** A `fetch` stand-in driven by a URL-prefix → response table. */
function stubFetch(
  routes: { match: string; response: () => Response | Promise<Response> }[],
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes.find((candidate) => url.startsWith(candidate.match));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route.response();
  }) as unknown as typeof fetch;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function stubLlm(fields: Partial<ParseFields>): LlmExtractor & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async extract(text) {
      calls.push(text);
      return fields;
    },
  };
}

/** Every test host resolves to a public IP — the SSRF guard is exercised in
 *  ssrf.test.ts, not here, so nothing should touch real DNS. */
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    fetchFn: stubFetch([]),
    llm: null,
    jinaKey: null,
    firecrawlKey: null,
    resolveHost: publicResolver,
    ...overrides,
  };
}

describe("runPipeline — L0 (fetch + OG/JSON-LD)", () => {
  it("extracts title, description, image and price from an ordinary shop", async () => {
    const llm = stubLlm({});
    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: stubFetch([
          { match: URL_UNDER_TEST, response: () => html(shopifyLike) },
        ]),
        llm,
      }),
    );

    expect(result.status).toBe("ok");
    expect(result.source).toBe("og");
    expect(result.fields).toEqual({
      title: "Handmade Ceramic Vase",
      description: "Hand-thrown stoneware vase with a matte glaze, 24 cm tall.",
      // og:image is relative in the fixture — resolved against the page URL.
      imageUrl: "https://clay-and-co.example/cdn/shop/files/vase-01.jpg?v=17",
      priceMin: "129.00",
      priceMax: null,
      currency: "GEL",
    });
    // Nothing was missing, so no tokens were spent.
    expect(llm.calls).toHaveLength(0);
  });

  it("sends a browser-shaped request", async () => {
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html(shopifyLike) },
    ]);
    await runPipeline(URL_UNDER_TEST, deps({ fetchFn }));

    const [, init] = vi.mocked(fetchFn).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("Chrome/");
    expect(headers["Accept-Language"]).toContain("en-US");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("runPipeline — L1 (LLM over fetched HTML)", () => {
  it("fills only the fields L0 left empty", async () => {
    // OG gives a title and an image, no price: the LLM must not overwrite the
    // title it disagrees with, only contribute the missing price.
    const partialOg = shopifyLike
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")
      .replace(/<meta\s+property="og:description"[\s\S]*?\/>/, "");
    const llm = stubLlm({
      title: "Some Other Vase",
      description: "Filled in by the model.",
      imageUrl: "https://cdn.example/model-guess.jpg",
      priceMin: "129.00",
      currency: "GEL",
    });

    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: stubFetch([
          { match: URL_UNDER_TEST, response: () => html(partialOg) },
        ]),
        llm,
      }),
    );

    expect(llm.calls).toHaveLength(1);
    expect(result.fields.title).toBe("Handmade Ceramic Vase");
    expect(result.fields.imageUrl).toBe(
      "https://clay-and-co.example/cdn/shop/files/vase-01.jpg?v=17",
    );
    expect(result.fields.description).toBe("Filled in by the model.");
    expect(result.fields.priceMin).toBe("129.00");
    expect(result.fields.currency).toBe("GEL");
    // The first contributing layer keeps the attribution.
    expect(result.source).toBe("og");
    expect(result.status).toBe("ok");
  });

  it("carries a client-rendered shell on the LLM alone", async () => {
    const llm = stubLlm({ title: "Ceramic Vase", priceMin: "80.00" });
    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: stubFetch([
          { match: URL_UNDER_TEST, response: () => html(emptyShell) },
        ]),
        llm,
      }),
    );

    expect(result.source).toBe("llm");
    expect(result.status).toBe("ok");
    expect(result.fields.title).toBe("Ceramic Vase");
  });

  it("survives an LLM that throws, falling back to the document title", async () => {
    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: stubFetch([
          { match: URL_UNDER_TEST, response: () => html(emptyShell) },
        ]),
        llm: {
          extract: () => Promise.reject(new Error("rate limited")),
        },
      }),
    );

    expect(result.status).toBe("partial");
    expect(result.fields.title).toBe("Store");
  });

  it("prefers OG and LLM titles over the document title", async () => {
    // The `<title>` carries the shop name and a slogan; the model reads the
    // product name off the page. The weaker signal must not win.
    const page =
      "<!doctype html><html><head><title>Vase — Clay &amp; Co | Free shipping</title>" +
      '<meta name="description" content="Shop tableware." /></head><body><p>' +
      "lorem ipsum dolor sit amet ".repeat(120) +
      "</p></body></html>";
    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: stubFetch([
          { match: URL_UNDER_TEST, response: () => html(page) },
        ]),
        llm: stubLlm({ title: "Handmade Ceramic Vase" }),
      }),
    );

    expect(result.fields.title).toBe("Handmade Ceramic Vase");
    // Nothing better was available for the description, so the weak one stands.
    expect(result.fields.description).toBe("Shop tableware.");
    expect(result.source).toBe("llm");
  });
});

describe("runPipeline — L2 (Jina Reader)", () => {
  const JINA = "https://r.jina.ai/";
  const READER_OUTPUT = [
    "Title: Handmade Ceramic Vase",
    `URL Source: ${URL_UNDER_TEST}`,
    "",
    "Markdown Content:",
    "Hand-thrown stoneware vase, 129.00 GEL",
  ].join("\n");

  it("takes over when the page is an anti-bot challenge", async () => {
    const llm = stubLlm({ priceMin: "129.00", currency: "GEL" });
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html(challenge) },
      { match: JINA, response: () => new Response(READER_OUTPUT) },
    ]);

    const result = await runPipeline(URL_UNDER_TEST, deps({ fetchFn, llm }));

    expect(vi.mocked(fetchFn).mock.calls[1][0]).toBe(
      `${JINA}${URL_UNDER_TEST}`,
    );
    expect(result.source).toBe("jina");
    expect(result.status).toBe("ok");
    expect(result.fields.title).toBe("Handmade Ceramic Vase");
    expect(result.fields.priceMin).toBe("129.00");
  });

  it("takes over on a refusal status", async () => {
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html("blocked", 403) },
      { match: JINA, response: () => new Response(READER_OUTPUT) },
    ]);
    const result = await runPipeline(URL_UNDER_TEST, deps({ fetchFn }));

    // No LLM configured: the reader header alone still yields a title.
    expect(result.status).toBe("partial");
    expect(result.fields.title).toBe("Handmade Ceramic Vase");
  });

  it("takes over on a truncated body", async () => {
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html("<html></html>") },
      { match: JINA, response: () => new Response(READER_OUTPUT) },
    ]);
    const result = await runPipeline(URL_UNDER_TEST, deps({ fetchFn }));
    expect(result.fields.title).toBe("Handmade Ceramic Vase");
  });

  it("sends the API key when one is configured", async () => {
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html(challenge) },
      { match: JINA, response: () => new Response(READER_OUTPUT) },
    ]);
    await runPipeline(URL_UNDER_TEST, deps({ fetchFn, jinaKey: "jina-key" }));

    const [, init] = vi.mocked(fetchFn).mock.calls[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer jina-key",
    );
  });
});

describe("runPipeline — L3 (Firecrawl)", () => {
  const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";

  it("is the last resort, and only with a key", async () => {
    const llm = stubLlm({ title: "Handmade Ceramic Vase", priceMin: "129.00" });
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html(challenge) },
      {
        match: "https://r.jina.ai/",
        response: () => new Response("", { status: 451 }),
      },
      {
        match: FIRECRAWL,
        response: () =>
          Response.json({
            success: true,
            data: { markdown: "# Vase\n129 GEL" },
          }),
      },
    ]);

    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({ fetchFn, llm, firecrawlKey: "fc-key" }),
    );

    const [url, init] = vi.mocked(fetchFn).mock.calls[2];
    expect(url).toBe(FIRECRAWL);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      url: URL_UNDER_TEST,
      formats: ["markdown"],
    });
    expect(result.source).toBe("firecrawl");
    expect(result.status).toBe("ok");
  });

  it("is skipped without a key", async () => {
    const fetchFn = stubFetch([
      { match: URL_UNDER_TEST, response: () => html(challenge) },
      {
        match: "https://r.jina.ai/",
        response: () => new Response("", { status: 451 }),
      },
    ]);
    const result = await runPipeline(URL_UNDER_TEST, deps({ fetchFn }));

    expect(vi.mocked(fetchFn)).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: "failed",
      source: null,
      fields: {
        title: null,
        description: null,
        imageUrl: null,
        priceMin: null,
        priceMax: null,
        currency: null,
      },
    });
  });
});

describe("runPipeline — failure handling", () => {
  it("reports failed when the network is simply gone", async () => {
    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: (() => Promise.reject(new Error("ECONNREFUSED"))) as never,
      }),
    );
    expect(result.status).toBe("failed");
  });

  it("is partial when only a title could be found", async () => {
    const bare =
      "<!doctype html><html><head><title>x</title>" +
      '<meta property="og:title" content="Ceramic Vase" /></head><body><p>' +
      "lorem ipsum dolor sit amet ".repeat(120) +
      "</p></body></html>";
    const result = await runPipeline(
      URL_UNDER_TEST,
      deps({
        fetchFn: stubFetch([
          { match: URL_UNDER_TEST, response: () => html(bare) },
          {
            match: "https://r.jina.ai/",
            response: () => new Response("", { status: 429 }),
          },
        ]),
      }),
    );
    expect(result.status).toBe("partial");
    expect(result.fields.title).toBe("Ceramic Vase");
  });
});

describe("cleanHtml", () => {
  it("drops scripts, styles and markup but keeps head metadata and text", () => {
    const cleaned = cleanHtml(shopifyLike);
    expect(cleaned).toContain('property="og:title"');
    expect(cleaned).toContain("Hand-thrown stoneware vase");
    expect(cleaned).toContain("Clay & Co");
    expect(cleaned).not.toContain("ShopifyAnalytics");
    expect(cleaned).not.toContain(".product-card {");
    expect(cleaned).not.toContain("<p>");
  });
});
