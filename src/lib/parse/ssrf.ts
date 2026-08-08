import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SSRF guard for every server-side fetch the parser makes.
 *
 * The URL comes from the user, and the *image* URL comes from parsed HTML or an
 * LLM's output — all attacker-influenceable. Without this, pasting
 * `http://169.254.169.254/…` or `http://127.0.0.1:6379/…` would have our server
 * issue the request from inside the trust boundary (cloud metadata, Redis,
 * internal admin panels). So before we fetch anything we assert the target
 * resolves to a *public* address.
 *
 * RESIDUAL RISK — DNS-rebinding TOCTOU: we validate the hostname and the IPs it
 * currently resolves to, but the socket is not pinned to a validated IP, so a
 * hostname whose DNS flips between this check and the actual `fetch` could still
 * reach a private address. Closing that fully needs a custom dispatcher/agent
 * that connects to the pre-resolved IP with the original Host header. For a
 * personal wishlist that only ever GETs product pages this is an accepted risk;
 * the practical exploit (exfiltrating cloud metadata) is already blunted because
 * the fetched bytes are only ever used to fill a form or stored as an image,
 * never echoed back to the attacker.
 */

export type ResolvedAddress = { address: string; family: number };
export type HostLookup = (hostname: string) => Promise<ResolvedAddress[]>;

/** Cloud metadata endpoints reached by name rather than by literal IP. */
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog"]);

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true });
}

/* ── IP literal parsing ──────────────────────────────────────────────────── */

function ipv4ToBytes(input: string): number[] | null {
  if (net.isIP(input) !== 4) return null;
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  return bytes;
}

/** Expands a (net.isIP-validated) IPv6 string to its 16 bytes, resolving `::`
 *  compression and any embedded IPv4 tail. */
function ipv6ToBytes(input: string): number[] | null {
  let text = input;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  text = text.split("%")[0];
  if (net.isIP(text) !== 6) return null;

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const tokens = part.split(":");
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.includes(".")) {
        if (i !== tokens.length - 1) return null;
        const v4 = ipv4ToBytes(token);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return null;
        groups.push(parseInt(token, 16));
      }
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !tail) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) bytes.push((group >> 8) & 0xff, group & 0xff);
  return bytes;
}

/* ── Deny ranges ─────────────────────────────────────────────────────────── */

function isPrivateIpv4(b: number[]): boolean {
  const [a, second] = b;
  if (a === 0) return true; // 0.0.0.0/8 — "this host"
  if (a === 10) return true; // 10.0.0.0/8 — private
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && second === 254) return true; // 169.254.0.0/16 — link-local
  if (a === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  if (a === 192 && second === 168) return true; // 192.168.0.0/16 — private
  if (a === 100 && second >= 64 && second <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255
  return false;
}

function isIpv4Mapped(b: number[]): boolean {
  // ::ffff:0:0/96 (mapped) and ::/96 (deprecated compat, incl. embedded v4).
  for (let i = 0; i < 10; i += 1) if (b[i] !== 0) return false;
  const mapped = b[10] === 0xff && b[11] === 0xff;
  const compat = b[10] === 0 && b[11] === 0;
  return mapped || compat;
}

function isPrivateIpv6(b: number[]): boolean {
  if (b.every((byte) => byte === 0)) return true; // :: unspecified
  if (b.slice(0, 15).every((byte) => byte === 0) && b[15] === 1) return true; // ::1
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local (private)
  return false;
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const bytes = ipv4ToBytes(ip);
    return !bytes || isPrivateIpv4(bytes);
  }
  if (family === 6) {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return true;
    if (isIpv4Mapped(bytes)) return isPrivateIpv4(bytes.slice(12));
    return isPrivateIpv6(bytes);
  }
  return true; // not a literal IP — should not reach here
}

/* ── Public entry point ──────────────────────────────────────────────────── */

/**
 * True when `url` is an http(s) URL whose target is a public host. The optional
 * `deps.lookup` exists only so tests can resolve hosts without touching real
 * DNS; production always uses the system resolver.
 */
export async function assertPublicUrl(
  url: string,
  deps: { lookup?: HostLookup } = {},
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return false;
  if (METADATA_HOSTS.has(host)) return false;

  // IP literals: the WHATWG URL parser already folded decimal/hex/octal/short
  // and IPv4-mapped-IPv6 forms into canonical shape, so net.isIP recognises
  // exactly what fetch will dial.
  if (net.isIP(host) !== 0) return !isBlockedIp(host);

  // Hostnames must be fully qualified — a single label ("localhost",
  // "intranet") is never a public product page and often an internal name.
  if (!host.includes(".")) return false;

  const lookup = deps.lookup ?? defaultLookup;
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(host);
  } catch {
    return false;
  }
  if (!addresses || addresses.length === 0) return false;
  return addresses.every(({ address }) => !isBlockedIp(address));
}

/* ── SSRF-safe fetch (manual redirect re-validation) ─────────────────────── */

export type SafeFetchOptions = {
  timeoutMs: number;
  /** Overall-deadline signal shared across the whole parse. */
  signal?: AbortSignal;
  /** Redirect hops to follow, each re-validated. */
  maxHops?: number;
  lookup?: HostLookup;
};

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed/locked — nothing to release.
  }
}

/**
 * Fetches `url` only after `assertPublicUrl` passes, with `redirect: "manual"`
 * so each 3xx `Location` is re-validated before it is followed (an open
 * redirect on a public host is a classic way to bounce a fetch into private
 * space). Returns null on any block, failure, timeout, or too many hops — the
 * caller treats null as "this layer got nothing" and moves on.
 */
export async function safeFetch(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  opts: SafeFetchOptions,
): Promise<Response | null> {
  const maxHops = opts.maxHops ?? 2;
  let current = url;

  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (!(await assertPublicUrl(current, { lookup: opts.lookup }))) return null;

    let response: Response;
    try {
      response = await fetchFn(current, {
        ...init,
        redirect: "manual",
        signal: combineSignals(opts.timeoutMs, opts.signal),
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await cancelBody(response);
      if (!location) return null;
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    return response;
  }
  return null; // redirect budget exhausted
}
