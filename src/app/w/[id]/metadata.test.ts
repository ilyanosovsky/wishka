import { afterEach, describe, expect, it, vi } from "vitest";

import { SOCIAL_PREVIEW_PATH } from "@/lib/metadata";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "ru",
  getTranslations: async () => (key: string) => key,
}));

const getVisibleWish = vi.fn();
vi.mock("@/db/access/viewer", () => ({
  getVisibleWish: (db: unknown, id: string, viewer: unknown) =>
    getVisibleWish(db, id, viewer),
}));

async function metadataFor(id: string) {
  const { generateMetadata } = await import("./page");
  return generateMetadata({ params: Promise.resolve({ id }) });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("/w/[id] share card", () => {
  it("uses only the branded fallback for an unknown or restricted wish", async () => {
    getVisibleWish.mockResolvedValue(null);

    const meta = await metadataFor("hidden");

    expect(getVisibleWish).toHaveBeenCalledWith({}, "hidden", {
      anonymous: true,
    });
    expect(meta.title).toEqual({ absolute: "Wishka" });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: SOCIAL_PREVIEW_PATH }),
    ]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("publishes a ready, re-hosted wish image", async () => {
    const image = "https://app123.ufs.sh/f/wish-headphones";
    getVisibleWish.mockResolvedValue({
      title: "Headphones",
      description: "Noise-cancelling headphones",
      imageStatus: "ready",
      imageKey: image,
    });

    const meta = await metadataFor("wish-1");

    expect(meta.title).toBe("Headphones");
    expect(meta.openGraph?.images).toEqual([image]);
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [image],
    });
  });

  it("falls back to the branded image while a wish image is unavailable", async () => {
    getVisibleWish.mockResolvedValue({
      title: "Weekend away",
      description: null,
      imageStatus: "none",
      imageKey: null,
    });

    const meta = await metadataFor("wish-2");

    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: SOCIAL_PREVIEW_PATH }),
    ]);
  });
});
