import { safeFetch, type HostLookup } from "./ssrf";

/**
 * Product invariant #6: a shop's image URL never reaches a wish card. On
 * creation we take a copy into our own storage, so nothing hotlinks, no
 * `remotePatterns` wildcard is needed, and the picture survives the shop
 * deleting it.
 *
 * The image URL is attacker-influenceable (it comes from parsed HTML or an
 * LLM's output), so this function is a second SSRF surface after the page
 * fetch — and it must not trust the shop's own `Content-Type` header. So:
 *
 *   1. `assertPublicUrl` / `safeFetch` gate the fetch the same way L0 is gated;
 *   2. we stream the bytes ourselves and enforce the size cap as they arrive,
 *      never trusting `Content-Length`;
 *   3. we sniff the leading magic bytes to prove it is really an image, then
 *      store via `putBuffer` — we never hand UploadThing the raw URL, which
 *      would make it re-fetch (a TOCTOU double-fetch that skips every check
 *      above).
 *
 * Nothing here throws. A wish must be addable when the image cannot be fetched
 * (invariant #3), so every failure is just `null` and the form falls back to
 * "no photo".
 */

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 8 * 1024 * 1024;

export type RehostDeps = {
  /** Wired to `storage.putBuffer` in the server action. */
  storagePut: (
    data: Uint8Array,
    name: string,
    contentType: string,
    signal?: AbortSignal,
  ) => Promise<{ url: string }>;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** Shared overall-parse deadline. */
  signal?: AbortSignal;
  /** Test-only DNS injection. */
  resolveHost?: HostLookup;
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
};

/**
 * Content type from the leading bytes, or null when they are not a recognised
 * image. The shop's declared header is ignored entirely — this is the only
 * source of truth for what we store.
 */
function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  // AVIF / HEIC: "ftyp" at offset 4, then a known brand.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
  }
  return null;
}

/** `.../images/blue-vase_800x.jpg?v=12` → "blue-vase_800x.jpg" */
function fileName(url: URL, contentType: string): string {
  const base = decodeURIComponent(url.pathname.split("/").pop() ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 100);
  const extension = EXTENSION_BY_TYPE[contentType] ?? "jpg";
  if (!base) return `wish-image.${extension}`;
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extension}`;
}

/** Reads the body, aborting the moment it exceeds the cap. Returns null on
 *  overflow or a stream error rather than buffering an unbounded payload. */
async function readCapped(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function rehostImage(
  externalUrl: string,
  deps: RehostDeps,
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(externalUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const response = await safeFetch(
    deps.fetchFn ?? fetch,
    externalUrl,
    {},
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      signal: deps.signal,
      lookup: deps.resolveHost,
    },
  );
  if (!response) return null;

  try {
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }

    const bytes = await readCapped(response);
    if (!bytes) return null;

    const contentType = sniffImageType(bytes);
    if (!contentType) return null;

    const stored = await deps.storagePut(
      bytes,
      fileName(parsed, contentType),
      contentType,
      deps.signal,
    );
    return stored?.url ?? null;
  } catch {
    return null;
  }
}
