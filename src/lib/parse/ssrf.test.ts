// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { assertPublicUrl, safeFetch, type ResolvedAddress } from "./ssrf";

const publicIp = async (): Promise<ResolvedAddress[]> => [
  { address: "93.184.216.34", family: 4 },
];

describe("assertPublicUrl — IP literals (no DNS)", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data/", // AWS/GCP metadata
    "http://127.0.0.1:6379/", // loopback (Redis)
    "http://127.1/", // short-form loopback
    "http://2130706433/", // decimal loopback
    "http://0x7f000001/", // hex loopback
    "http://0177.0.0.1/", // octal loopback
    "http://10.0.0.1/", // private 10/8
    "http://172.16.5.4/", // private 172.16/12
    "http://172.31.255.1/", // private 172.16/12 upper edge
    "http://192.168.1.1/", // private 192.168/16
    "http://100.64.0.1/", // CGNAT 100.64/10
    "http://0.0.0.0/", // unspecified
    "http://[::1]/", // IPv6 loopback
    "http://[::ffff:127.0.0.1]/", // IPv4-mapped loopback
    "http://[::ffff:10.0.0.1]/", // IPv4-mapped private
    "http://[fe80::1]/", // IPv6 link-local
    "http://[fc00::1]/", // IPv6 unique-local
    "http://[::]/", // IPv6 unspecified
  ])("blocks %s", async (url) => {
    expect(await assertPublicUrl(url, { lookup: publicIp })).toBe(false);
  });

  it("allows a public IPv4 literal", async () => {
    expect(await assertPublicUrl("http://93.184.216.34/", {})).toBe(true);
  });

  it("allows a public IPv6 literal", async () => {
    expect(await assertPublicUrl("http://[2606:2800:220:1::]/", {})).toBe(true);
  });
});

describe("assertPublicUrl — hostnames", () => {
  it("blocks cloud-metadata hostnames without resolving them", async () => {
    const lookup = vi.fn();
    expect(
      await assertPublicUrl("http://metadata.google.internal/", { lookup }),
    ).toBe(false);
    expect(await assertPublicUrl("http://metadata.goog/", { lookup })).toBe(
      false,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks single-label / non-FQDN hosts", async () => {
    const lookup = vi.fn();
    expect(await assertPublicUrl("http://localhost/", { lookup })).toBe(false);
    expect(await assertPublicUrl("http://intranet/", { lookup })).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("allows a host that resolves only to public addresses", async () => {
    expect(
      await assertPublicUrl("https://shop.example/p/1", { lookup: publicIp }),
    ).toBe(true);
  });

  it("blocks a host that resolves to a private address (DNS rebinding)", async () => {
    const lookup = async () => [{ address: "10.0.0.5", family: 4 }];
    expect(await assertPublicUrl("https://evil.example/p/1", { lookup })).toBe(
      false,
    );
  });

  it("blocks when ANY resolved address is private", async () => {
    const lookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    expect(await assertPublicUrl("https://mixed.example/", { lookup })).toBe(
      false,
    );
  });

  it("blocks a host that resolves to a mapped private IPv6", async () => {
    const lookup = async () => [{ address: "::ffff:192.168.0.9", family: 6 }];
    expect(await assertPublicUrl("https://evil.example/", { lookup })).toBe(
      false,
    );
  });

  it("treats a lookup failure or empty result as blocked", async () => {
    expect(
      await assertPublicUrl("https://nx.example/", {
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).toBe(false);
    expect(
      await assertPublicUrl("https://empty.example/", {
        lookup: async () => [],
      }),
    ).toBe(false);
  });
});

describe("assertPublicUrl — scheme", () => {
  it.each([
    "ftp://files.example/x",
    "file:///etc/passwd",
    "gopher://x/",
    "not a url",
  ])("rejects %s", async (url) => {
    expect(await assertPublicUrl(url, { lookup: publicIp })).toBe(false);
  });
});

describe("safeFetch", () => {
  const OK = () => new Response("ok", { status: 200 });

  function redirectTo(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } });
  }

  it("fetches a public URL with manual redirect handling", async () => {
    const fetchFn = vi.fn(async () => OK()) as unknown as typeof fetch;
    const res = await safeFetch(
      fetchFn,
      "https://shop.example/p",
      {},
      {
        timeoutMs: 1000,
        lookup: publicIp,
      },
    );
    expect(res?.status).toBe(200);
    const [, init] = vi.mocked(fetchFn).mock.calls[0];
    expect(init?.redirect).toBe("manual");
  });

  it("does not fetch a blocked target", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const res = await safeFetch(
      fetchFn,
      "http://127.0.0.1/",
      {},
      {
        timeoutMs: 1000,
      },
    );
    expect(res).toBeNull();
    expect(vi.mocked(fetchFn)).not.toHaveBeenCalled();
  });

  it("re-validates each redirect hop and refuses a bounce to a private host", async () => {
    const lookup = async (host: string): Promise<ResolvedAddress[]> =>
      host === "shop.example"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "10.0.0.1", family: 4 }];
    const fetchFn = vi.fn(async () =>
      redirectTo("https://internal.example/admin"),
    ) as unknown as typeof fetch;

    const res = await safeFetch(
      fetchFn,
      "https://shop.example/p",
      {},
      {
        timeoutMs: 1000,
        lookup,
      },
    );
    expect(res).toBeNull();
    // First hop was fetched; the redirect target was rejected before a 2nd.
    expect(vi.mocked(fetchFn)).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public host", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("https://shop.example/final"))
      .mockResolvedValueOnce(OK()) as unknown as typeof fetch;

    const res = await safeFetch(
      fetchFn,
      "https://shop.example/p",
      {},
      {
        timeoutMs: 1000,
        lookup: publicIp,
      },
    );
    expect(res?.status).toBe(200);
    expect(vi.mocked(fetchFn)).toHaveBeenCalledTimes(2);
  });

  it("gives up after the redirect budget is exhausted", async () => {
    const fetchFn = vi.fn(async () =>
      redirectTo("https://shop.example/loop"),
    ) as unknown as typeof fetch;

    const res = await safeFetch(
      fetchFn,
      "https://shop.example/p",
      {},
      {
        timeoutMs: 1000,
        lookup: publicIp,
        maxHops: 2,
      },
    );
    expect(res).toBeNull();
    // Initial + 2 hops = 3 fetches, then it stops.
    expect(vi.mocked(fetchFn)).toHaveBeenCalledTimes(3);
  });
});
