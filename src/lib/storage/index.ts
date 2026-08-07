/**
 * Storage port — every image write in the app goes through this interface
 * (product invariant #6: swapping the vendor must be a one-file change).
 * Current implementation: UploadThing (./uploadthing.ts).
 */
export interface StoragePort {
  /** Fetch an external image server-side and store a copy. */
  putFromUrl(url: string, name: string): Promise<StoredFile>;
  /** Store an in-memory buffer (AI-generated images, processed uploads). */
  putBuffer(
    data: Buffer | Uint8Array,
    name: string,
    contentType: string,
  ): Promise<StoredFile>;
  delete(key: string): Promise<void>;
}

export interface StoredFile {
  key: string;
  url: string;
}

export { uploadThingStorage as storage } from "./uploadthing";
