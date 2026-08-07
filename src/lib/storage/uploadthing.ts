import "server-only";

import { UTApi, UTFile } from "uploadthing/server";
import type { StoragePort, StoredFile } from "./index";

/** Extract the file key from one of our CDN URLs (`https://<app>.ufs.sh/f/<key>`
 *  or legacy `https://utfs.io/f/<key>`); null for anything foreign. */
export function extractStorageKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const isOurs =
      parsed.hostname.endsWith(".ufs.sh") || parsed.hostname === "utfs.io";
    const match = parsed.pathname.match(/^\/f\/([^/]+)$/);
    return isOurs && match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Server-only. Requires UPLOADTHING_TOKEN. */
let api: UTApi | null = null;

function getApi(): UTApi {
  api ??= new UTApi();
  return api;
}

function toStoredFile(data: { key: string; ufsUrl: string }): StoredFile {
  return { key: data.key, url: data.ufsUrl };
}

export const uploadThingStorage: StoragePort = {
  async putFromUrl(url, name) {
    const result = await getApi().uploadFilesFromUrl({ url, name });
    if (result.error || !result.data) {
      throw new Error(
        `uploadFilesFromUrl failed: ${result.error?.message ?? "no data"}`,
      );
    }
    return toStoredFile(result.data);
  },

  async putBuffer(data, name, contentType) {
    const file = new UTFile([new Uint8Array(data)], name, {
      type: contentType,
    });
    const [result] = await getApi().uploadFiles([file]);
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
};
