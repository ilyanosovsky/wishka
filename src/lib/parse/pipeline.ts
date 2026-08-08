import ogs from "open-graph-scraper";

import type { LlmExtractor } from "./llm";
import { detectCurrency, normalizeAmount } from "./price";
import { assertPublicUrl, safeFetch, type HostLookup } from "./ssrf";
import {
  EMPTY_FIELDS,
  mergeFields,
  type ParseFields,
  type ParseSource,
  type PipelineResult,
} from "./types";

/**
 * The layered parsing pipeline (VISION §5).
 *
 *   L0  plain fetch + OG/JSON-LD      — free, ~1–2s, covers ordinary shops
 *   L1  LLM extraction over the HTML  — fractions of a cent, fills the gaps
 *   L2  Jina Reader                   — free, used when L0 is blocked
 *   L3  Firecrawl                     — 1000 free pages/month, last resort
 *   L4  manual entry                  — not here: adding a wish never depends
 *                                       on this file succeeding (invariant #3)
 *
 * Every dependency is injected so the whole thing runs in tests with no
 * network and no API keys.
 */

export type PipelineDeps = {
  fetchFn: typeof fetch;
  /** null when the app runs without an OpenAI key — LLM layers are skipped. */
  llm: LlmExtractor | null;
  jinaKey?: string | null;
  firecrawlKey?: string | null;
  /** Overall parse deadline (set in the server action) — aborts every fetch. */
  signal?: AbortSignal;
  /** Test-only DNS injection; production uses the system resolver. */
  resolveHost?: HostLookup;
  log?: (msg: string) => void;
};

/** Chrome on Windows: the least interesting visitor an anti-bot can see. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
};

const PAGE_TIMEOUT_MS = 8_000;
const JINA_TIMEOUT_MS = 12_000;
const FIRECRAWL_TIMEOUT_MS = 20_000;

/** Anything shorter than this is an interstitial or an error page, not a shop. */
const MIN_HTML_LENGTH = 2_048;

/**
 * Anti-bot fingerprints. `captcha` and `robot` are matched with word
 * boundaries on purpose: half the shops on the internet embed reCAPTCHA in a
 * newsletter form or ship `<meta name="robots">`, and treating those as a
 * challenge would push perfectly parseable pages to the paid layers.
 */
const CHALLENGE_RE =
  /\bcaptcha\b|\brobot\b|access denied|bm-verify|antibot|punish|__wbaas/i;

/** How much page text the LLM layers get to see. */
const LLM_TEXT_LIMIT = 18_000;
const LLM_HEAD_LIMIT = 6_000;

type FetchedPage = { html: string } | { html: null; blocked: true };

/**
 * A plain timed fetch for our *trusted* helper endpoints (Jina, Firecrawl):
 * their host is fixed and known, so they do not need the full SSRF dance, but
 * they do share the overall deadline. The untrusted page/image URLs go through
 * `safeFetch` instead.
 */
async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response | null> {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  try {
    return await fetchFn(url, {
      redirect: "follow",
      ...init,
      signal: AbortSignal.any(signals),
    });
  } catch {
    return null;
  }
}

/** L0. A blocked result is normal, not an error — it just routes to L2. */
async function fetchPage(
  url: string,
  deps: PipelineDeps,
  log: (msg: string) => void,
): Promise<FetchedPage> {
  const response = await safeFetch(
    deps.fetchFn,
    url,
    { headers: BROWSER_HEADERS },
    {
      timeoutMs: PAGE_TIMEOUT_MS,
      signal: deps.signal,
      lookup: deps.resolveHost,
    },
  );
  if (!response) {
    log("L0 fetch failed (network, timeout, or non-public target)");
    return { html: null, blocked: true };
  }
  // 403/429 are the polite refusals; 498/499 are Akamai/PerimeterX specials.
  if (!response.ok) {
    log(`L0 blocked: status ${response.status}`);
    return { html: null, blocked: true };
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    log("L0 body read failed");
    return { html: null, blocked: true };
  }

  if (html.length < MIN_HTML_LENGTH) {
    log(`L0 blocked: body too small (${html.length})`);
    return { html: null, blocked: true };
  }
  if (CHALLENGE_RE.test(html)) {
    log("L0 blocked: challenge markers");
    return { html: null, blocked: true };
  }
  return { html };
}

function absolute(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  try {
    const resolved = new URL(value, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

function textValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

/* ── JSON-LD ─────────────────────────────────────────────────────────────── */

type JsonObject = Record<string, unknown>;

/** Flattens `@graph`, arrays and one level of nested nodes into a node list. */
function collectNodes(value: unknown, out: JsonObject[], depth = 0): void {
  if (depth > 4 || !value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const node = value as JsonObject;
  out.push(node);
  if ("@graph" in node) collectNodes(node["@graph"], out, depth + 1);
  if ("mainEntity" in node) collectNodes(node.mainEntity, out, depth + 1);
  if ("itemListElement" in node) {
    collectNodes(node.itemListElement, out, depth + 1);
  }
}

function isProduct(node: JsonObject): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some(
    (candidate) =>
      typeof candidate === "string" && /product/i.test(candidate.trim()),
  );
}

function firstImage(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImage(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    return textValue((value as JsonObject).url);
  }
  return textValue(value);
}

type OfferPrice = {
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
};

function readOffers(value: unknown, depth = 0): OfferPrice | null {
  if (depth > 3 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readOffers(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const offer = value as JsonObject;

  const low = normalizeAmount(offer.lowPrice);
  const high = normalizeAmount(offer.highPrice);
  const exact =
    normalizeAmount(offer.price) ??
    normalizeAmount(
      (offer.priceSpecification as JsonObject | undefined)?.price,
    );

  const priceMin = low ?? exact;
  if (!priceMin) {
    return readOffers(offer.offers, depth + 1);
  }

  const currency =
    detectCurrency(textValue(offer.priceCurrency)) ??
    detectCurrency(
      textValue(
        (offer.priceSpecification as JsonObject | undefined)?.priceCurrency,
      ),
    );

  return {
    priceMin,
    priceMax: high && Number(high) > Number(priceMin) ? high : null,
    currency,
  };
}

function fromJsonLd(nodes: unknown, baseUrl: string): Partial<ParseFields> {
  const flat: JsonObject[] = [];
  collectNodes(nodes, flat);
  const product = flat.find(isProduct);
  if (!product) return {};

  const offers = readOffers(product.offers);
  const fields: Partial<ParseFields> = {};

  const title = textValue(product.name);
  if (title) fields.title = title;
  const description = textValue(product.description);
  if (description) fields.description = description;
  const image = absolute(firstImage(product.image), baseUrl);
  if (image) fields.imageUrl = image;
  if (offers?.priceMin) {
    fields.priceMin = offers.priceMin;
    if (offers.priceMax) fields.priceMax = offers.priceMax;
    if (offers.currency) fields.currency = offers.currency;
  }
  return fields;
}

/* ── L0 extraction: Open Graph + JSON-LD ─────────────────────────────────── */

/**
 * Parses an HTML string. `open-graph-scraper` is given `html` (never `url`), so
 * it works off the body we already fetched instead of fetching again.
 *
 * `onlyGetOpenGraphInfo` is an *array* on purpose: it switches off ogs's
 * guessing for those three fields (a `<title>` reads "Vase — Shop | Sale", a
 * fallback image is usually the logo) while keeping JSON-LD parsing on — ogs
 * skips JSON-LD entirely when the option is `true`. The softer `<title>`
 * signals come back later, through `extractHeadFallback`, after the LLM has
 * had its turn.
 */
export async function extractFromHtml(
  html: string,
  baseUrl: string,
): Promise<Partial<ParseFields>> {
  let result;
  try {
    ({ result } = await ogs({
      html,
      onlyGetOpenGraphInfo: ["title", "description", "image"],
    }));
  } catch {
    return {};
  }

  const fields: Partial<ParseFields> = {};
  const title = textValue(result.ogTitle) ?? textValue(result.twitterTitle);
  if (title) fields.title = title;

  const description =
    textValue(result.ogDescription) ?? textValue(result.twitterDescription);
  if (description) fields.description = description;

  const image = absolute(
    textValue(result.ogImage?.[0]?.url) ??
      textValue(result.twitterImage?.[0]?.url),
    baseUrl,
  );
  if (image) fields.imageUrl = image;

  const amount =
    normalizeAmount(result.ogPriceAmount) ??
    normalizeAmount(result.ogProductPriceAmount);
  if (amount) {
    fields.priceMin = amount;
    const currency = detectCurrency(
      textValue(result.ogPriceCurrency) ??
        textValue(result.ogProductPriceCurrency),
    );
    if (currency) fields.currency = currency;
  }

  // JSON-LD is usually the richer of the two (it carries offers); it fills
  // whatever the OG tags left empty.
  const merged = mergeFields(
    { ...EMPTY_FIELDS, ...fields },
    fromJsonLd(result.jsonLD, baseUrl),
  );
  return merged.fields;
}

/**
 * Last-resort head signals: the document `<title>` and `<meta name=
 * "description">`. Weaker than both OG/JSON-LD and the LLM, so the pipeline
 * applies it after those — a page title with the shop name and a "Free
 * shipping!" suffix is better than nothing and worse than anything else.
 */
export async function extractHeadFallback(
  html: string,
): Promise<Partial<ParseFields>> {
  let result;
  try {
    // Fallbacks stay on for title/description, off for image: ogs's image
    // guess is the first `<img>` on the page, which is the logo often enough.
    ({ result } = await ogs({ html, onlyGetOpenGraphInfo: ["image"] }));
  } catch {
    return {};
  }
  const fields: Partial<ParseFields> = {};
  const title = textValue(result.ogTitle);
  if (title) fields.title = title;
  const description = textValue(result.ogDescription);
  if (description) fields.description = description;
  return fields;
}

/* ── L1 input preparation ────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
    (match) => ENTITIES[match] ?? match,
  );
}

/**
 * Reduces a page to something worth paying tokens for: the `<head>` (where the
 * metadata lives, even when it is not OG) plus the visible body text.
 */
export function cleanHtml(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const head = stripped.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const body =
    stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? stripped;

  const headText = head.replace(/\s+/g, " ").trim().slice(0, LLM_HEAD_LIMIT);
  const bodyText = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LLM_TEXT_LIMIT);

  return `${headText}\n\n${bodyText}`.trim();
}

async function runLlm(
  llm: LlmExtractor,
  content: string,
  layer: string,
  log: (msg: string) => void,
): Promise<Partial<ParseFields>> {
  if (!content.trim()) return {};
  try {
    return await llm.extract(content);
  } catch (error) {
    log(`${layer} llm failed: ${(error as Error)?.message ?? "unknown"}`);
    return {};
  }
}

/* ── L2 / L3 ─────────────────────────────────────────────────────────────── */

/** Jina Reader prefixes its markdown with a `Title: …` header — free title
 *  even when there is no LLM to run over the body. */
function titleFromReader(markdown: string): Partial<ParseFields> {
  const title = markdown.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  return title ? { title } : {};
}

async function fetchJina(
  url: string,
  deps: PipelineDeps,
  log: (msg: string) => void,
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "User-Agent": USER_AGENT,
  };
  if (deps.jinaKey) headers.Authorization = `Bearer ${deps.jinaKey}`;

  const response = await fetchWithTimeout(
    deps.fetchFn,
    `https://r.jina.ai/${url}`,
    { headers },
    JINA_TIMEOUT_MS,
    deps.signal,
  );
  if (!response?.ok) {
    log(`L2 jina unavailable (${response?.status ?? "no response"})`);
    return null;
  }
  const markdown = await response.text().catch(() => "");
  return markdown.trim() ? markdown : null;
}

async function fetchFirecrawl(
  url: string,
  deps: PipelineDeps,
  log: (msg: string) => void,
): Promise<string | null> {
  const response = await fetchWithTimeout(
    deps.fetchFn,
    "https://api.firecrawl.dev/v2/scrape",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.firecrawlKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
    },
    FIRECRAWL_TIMEOUT_MS,
    deps.signal,
  );
  if (!response?.ok) {
    log(`L3 firecrawl unavailable (${response?.status ?? "no response"})`);
    return null;
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: { markdown?: unknown };
  } | null;
  const markdown = payload?.data?.markdown;
  return typeof markdown === "string" && markdown.trim() ? markdown : null;
}

/* ── Orchestration ───────────────────────────────────────────────────────── */

/**
 * Exported because the caller re-runs it: re-hosting can drop an image that
 * was part of what made a parse "ok", and the status it caches must describe
 * the fields it actually stored.
 */
export function statusOf(fields: ParseFields): PipelineResult["status"] {
  if (!fields.title) return "failed";
  return fields.imageUrl || fields.priceMin ? "ok" : "partial";
}

export async function runPipeline(
  url: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const log = deps.log ?? (() => {});
  let fields: ParseFields = { ...EMPTY_FIELDS };
  let source: ParseSource | null = null;

  const apply = (extra: Partial<ParseFields>, layer: ParseSource): void => {
    const merged = mergeFields(fields, extra);
    fields = merged.fields;
    // The first layer to contribute owns the attribution: OG tags topped up by
    // the LLM are still an "og" parse.
    if (merged.changed && source === null) source = layer;
  };

  // SSRF gate — a URL that points at a private/metadata/loopback target is
  // never fetched by us or handed to Jina/Firecrawl to fetch on our behalf.
  if (!(await assertPublicUrl(url, { lookup: deps.resolveHost }))) {
    log("blocked: URL resolves to a non-public address");
    return { status: "failed", fields: { ...EMPTY_FIELDS }, source: null };
  }

  // L0 — plain fetch.
  const page = await fetchPage(url, deps, log);
  if (page.html !== null) {
    apply(await extractFromHtml(page.html, url), "og");

    // L1 — pay for extraction only when the free layer left a real gap.
    const complete = fields.title && fields.imageUrl && fields.priceMin;
    if (!complete && deps.llm) {
      log("L1 llm extraction over html");
      apply(await runLlm(deps.llm, cleanHtml(page.html), "L1", log), "llm");
    }

    if (!fields.title || !fields.description) {
      apply(await extractHeadFallback(page.html), "og");
    }
  }

  // L2 — Jina Reader. Reached when L0 was blocked, and also when L0 answered
  // with a shell that yielded no title at all (client-rendered shops).
  if (!fields.title) {
    log("L2 jina reader");
    const markdown = await fetchJina(url, deps, log);
    if (markdown) {
      apply(titleFromReader(markdown), "jina");
      if (deps.llm) {
        apply(
          await runLlm(deps.llm, markdown.slice(0, LLM_TEXT_LIMIT), "L2", log),
          "jina",
        );
      }
    }
  }

  // L3 — Firecrawl, only with a key and only when nothing usable came back.
  if (!fields.title && deps.firecrawlKey) {
    log("L3 firecrawl");
    const markdown = await fetchFirecrawl(url, deps, log);
    if (markdown) {
      apply(titleFromReader(markdown), "firecrawl");
      if (deps.llm) {
        apply(
          await runLlm(deps.llm, markdown.slice(0, LLM_TEXT_LIMIT), "L3", log),
          "firecrawl",
        );
      }
    }
  }

  const status = statusOf(fields);
  log(`result: ${status} (source: ${source ?? "none"})`);
  return { status, fields, source: status === "failed" ? null : source };
}
