import "server-only";

import { UTApi, UTFile } from "uploadthing/server";
import type { StoragePort, StoredFile } from "./index";

/**
 * Our exact storage host, derived from `UPLOADTHING_TOKEN`.
 *
 * The token is base64-encoded JSON `{ apiKey, appId, regions }`; our public
 * host is `<appId>.ufs.sh` (live value `w017mt9g7y.ufs.sh`). Matching this host
 * *exactly* is a security control, not cosmetics: every `*.ufs.sh` subdomain is
 * a different UploadThing app, so treating any of them as "ours" (the previous
 * behaviour) let a shop's `og:image` of `https://attacker-app.ufs.sh/f/x` pass
 * the invariant-#6 host check and be hotlinked instead of re-hosted.
 */
export function appHostFromToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(token, "base64").toString("utf8"),
    ) as { appId?: unknown };
    return typeof decoded.appId === "string" && decoded.appId
      ? `${decoded.appId}.ufs.sh`
      : null;
  } catch {
    return null;
  }
}

// Decoded once at module load, as the token cannot change at runtime.
const OUR_HOST = appHostFromToken(process.env.UPLOADTHING_TOKEN);

/**
 * The file key when `url` is on *our* storage, else null. Exact host match
 * against the token-derived host, plus the legacy `utfs.io` host.
 *
 * FALLBACK: when no token is configured (local dev / CI, where nothing is ever
 * really uploaded) the app host is unknown, so we fall back to accepting any
 * `*.ufs.sh` subdomain — the old, looser rule. Production always has a token,
 * so the strict path is what ships. Kept as a named helper so tests can pin an
 * explicit host without depending on module-load env.
 */
export function keyForHost(url: string, ourHost: string | null): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isOurs =
      host === "utfs.io" ||
      (ourHost ? host === ourHost : host.endsWith(".ufs.sh"));
    const match = parsed.pathname.match(/^\/f\/([^/]+)$/);
    return isOurs && match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Extract the file key from one of our CDN URLs; null for anything foreign.
 *  Signature is load-bearing: `db/access/mutations.ts` re-checks stored image
 *  URLs through this, and tightening the host logic tightens that check too. */
export function extractStorageKey(url: string): string | null {
  return keyForHost(url, OUR_HOST);
}

/** Server-only. Requires UPLOADTHING_TOKEN. */
let api: UTApi | null = null;

function getApi(): UTApi {
  api ??= new UTApi();
  return api;
}

/** Hard cap on any single storage round-trip, folded into the caller's overall
 *  deadline when one is supplied. */
const STORAGE_TIMEOUT_MS = 20_000;

function uploadSignal(signal?: AbortSignal): AbortSignal {
  const signals: AbortSignal[] = [AbortSignal.timeout(STORAGE_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

function toStoredFile(data: { key: string; ufsUrl: string }): StoredFile {
  return { key: data.key, url: data.ufsUrl };
}

export const uploadThingStorage = {
  async putFromUrl(url, name, opts?: { signal?: AbortSignal }) {
    const result = await getApi().uploadFilesFromUrl(
      { url, name },
      { signal: uploadSignal(opts?.signal) },
    );
    if (result.error || !result.data) {
      throw new Error(
        `uploadFilesFromUrl failed: ${result.error?.message ?? "no data"}`,
      );
    }
    return toStoredFile(result.data);
  },

  async putBuffer(data, name, contentType, opts?: { signal?: AbortSignal }) {
    const file = new UTFile([new Uint8Array(data)], name, {
      type: contentType,
    });
    const [result] = await getApi().uploadFiles([file], {
      signal: uploadSignal(opts?.signal),
    });
    if (result.error || !result.data) {
      throw new Error(
        `uploadFiles failed: ${result.error?.message ?? "no data"}`,
      );
    }
    return toStoredFile(result.data);
  },

  async delete(key) {
    await getApi().deleteFiles([key]);
  },
  // `satisfies` (not `: StoragePort`) so the extra optional `opts` on the two
  // upload methods stays visible to callers while the port contract is still
  // enforced.
} satisfies StoragePort;
