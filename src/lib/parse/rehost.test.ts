// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { rehostImage, type RehostDeps } from "./rehost";

const IMAGE = "https://cdn.some-shop.example/images/blue-vase_800x.jpg?v=12";
const OURS = "https://w017mt9g7y.ufs.sh/f/abcdef123456";

const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

/** A minimal but valid JPEG header (FF D8 FF) padded out past the 12-byte
 *  sniff window. */
function jpegBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;
  return bytes;
}

function pngBytes(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = new Uint8Array(64);
  bytes.set(sig, 0);
  return bytes;
}

function imageResponse(bytes: Uint8Array, status = 200): Response {
  // The TS DOM lib narrows BodyInit's ArrayBufferView to ArrayBuffer-backed;
  // a plain Uint8Array is fine at runtime, so widen through BodyInit.
  return new Response(bytes as unknown as BodyInit, { status });
}

function storagePut() {
  return vi.fn<RehostDeps["storagePut"]>(async () => ({ url: OURS }));
}

function deps(overrides: Partial<RehostDeps> = {}): RehostDeps {
  return {
    storagePut: storagePut(),
    fetchFn: vi.fn(async () =>
      imageResponse(jpegBytes()),
    ) as unknown as typeof fetch,
    resolveHost: publicResolver,
    ...overrides,
  };
}

describe("rehostImage", () => {
  it("stores the streamed bytes and returns our own URL", async () => {
    const put = storagePut();
    const url = await rehostImage(IMAGE, deps({ storagePut: put }));

    expect(url).toBe(OURS);
    expect(put).toHaveBeenCalledTimes(1);
    const [data, name, contentType] = put.mock.calls[0];
    expect(data).toBeInstanceOf(Uint8Array);
    expect(name).toBe("blue-vase_800x.jpg");
    expect(contentType).toBe("image/jpeg");
  });

  it("sniffs the real type, ignoring the path extension", async () => {
    // URL says .jpg, bytes are PNG — we store what the bytes say.
    const put = storagePut();
    await rehostImage(
      "https://cdn.example/photo.jpg",
      deps({
        storagePut: put,
        fetchFn: vi.fn(async () =>
          imageResponse(pngBytes()),
        ) as unknown as typeof fetch,
      }),
    );
    expect(put.mock.calls[0][2]).toBe("image/png");
  });

  it("refuses bytes that are not a known image (defeats content-type spoofing)", async () => {
    const put = storagePut();
    const htmlBytes = new TextEncoder().encode(
      "<!doctype html><html>totally an image, promise</html>",
    );
    const url = await rehostImage(
      IMAGE,
      deps({
        storagePut: put,
        fetchFn: vi.fn(async () =>
          imageResponse(htmlBytes),
        ) as unknown as typeof fetch,
      }),
    );
    expect(url).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("aborts and refuses when the stream exceeds 8MB", async () => {
    const put = storagePut();
    const huge = jpegBytes(9 * 1024 * 1024);
    const url = await rehostImage(
      IMAGE,
      deps({
        storagePut: put,
        fetchFn: vi.fn(async () =>
          imageResponse(huge),
        ) as unknown as typeof fetch,
      }),
    );
    expect(url).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it("does not fetch a URL that resolves to a private address (SSRF)", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const url = await rehostImage(
      "http://169.254.169.254/latest/meta-data/",
      deps({ fetchFn }),
    );
    expect(url).toBeNull();
    expect(vi.mocked(fetchFn)).not.toHaveBeenCalled();
  });

  it("blocks a public-looking host that resolves private", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const url = await rehostImage(
      "https://evil.example/x.jpg",
      deps({
        fetchFn,
        resolveHost: async () => [{ address: "10.1.2.3", family: 4 }],
      }),
    );
    expect(url).toBeNull();
    expect(vi.mocked(fetchFn)).not.toHaveBeenCalled();
  });

  it("refuses a non-http URL without fetching", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    expect(
      await rehostImage("data:image/png;base64,AAAA", deps({ fetchFn })),
    ).toBeNull();
    expect(vi.mocked(fetchFn)).not.toHaveBeenCalled();
  });

  it("returns null on a 404", async () => {
    const url = await rehostImage(
      IMAGE,
      deps({
        fetchFn: vi.fn(
          async () => new Response("nope", { status: 404 }),
        ) as unknown as typeof fetch,
      }),
    );
    expect(url).toBeNull();
  });

  it("returns null instead of throwing when the fetch fails", async () => {
    const url = await rehostImage(
      IMAGE,
      deps({
        fetchFn: vi.fn(async () => {
          throw new Error("ETIMEDOUT");
        }) as unknown as typeof fetch,
      }),
    );
    expect(url).toBeNull();
  });

  it("returns null instead of throwing when storage fails", async () => {
    const url = await rehostImage(
      IMAGE,
      deps({
        storagePut: async () => {
          throw new Error("uploadFiles failed");
        },
      }),
    );
    expect(url).toBeNull();
  });

  it("derives a file name when the path has none", async () => {
    const put = storagePut();
    await rehostImage(
      "https://cdn.example/image?id=7",
      deps({ storagePut: put }),
    );
    expect(put.mock.calls[0][1]).toBe("image.jpg");
  });

  it("returns null for input that is not a URL at all", async () => {
    expect(await rehostImage("/images/relative.jpg", deps())).toBeNull();
  });
});
