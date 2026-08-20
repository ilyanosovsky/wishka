// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getBrandSocialMetadata,
  getMetadataBase,
  getSocialPreview,
  SOCIAL_PREVIEW_HEIGHT,
  SOCIAL_PREVIEW_PATH,
  SOCIAL_PREVIEW_WIDTH,
} from "./metadata";

const DESCRIPTION = "A wishlist made for sharing.";

describe("social metadata", () => {
  it("uses the configured public app URL as the absolute metadata base", () => {
    expect(
      getMetadataBase({
        NEXT_PUBLIC_APP_URL: "https://wishka-tau.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: undefined,
      }).href,
    ).toBe("https://wishka-tau.vercel.app/");
  });

  it("falls back to Vercel's production host, then localhost", () => {
    expect(
      getMetadataBase({
        NEXT_PUBLIC_APP_URL: undefined,
        VERCEL_PROJECT_PRODUCTION_URL: "wishka-tau.vercel.app",
      }).href,
    ).toBe("https://wishka-tau.vercel.app/");
    expect(
      getMetadataBase({
        NEXT_PUBLIC_APP_URL: undefined,
        VERCEL_PROJECT_PRODUCTION_URL: undefined,
      }).href,
    ).toBe("http://localhost:3000/");
  });

  it("publishes a 1200×630 large-image card for Open Graph and Twitter", () => {
    const social = getBrandSocialMetadata(DESCRIPTION);
    const image = getSocialPreview(DESCRIPTION);

    expect(image).toMatchObject({
      url: SOCIAL_PREVIEW_PATH,
      width: SOCIAL_PREVIEW_WIDTH,
      height: SOCIAL_PREVIEW_HEIGHT,
    });
    expect(social.openGraph).toMatchObject({
      title: "Wishka",
      description: DESCRIPTION,
      images: [image],
    });
    expect(social.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Wishka",
      description: DESCRIPTION,
      images: [image],
    });
  });

  it("keeps the published preview as a real 1200×630 PNG", async () => {
    const png = await readFile(
      path.join(process.cwd(), "public", SOCIAL_PREVIEW_PATH.slice(1)),
    );

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.readUInt32BE(16)).toBe(SOCIAL_PREVIEW_WIDTH);
    expect(png.readUInt32BE(20)).toBe(SOCIAL_PREVIEW_HEIGHT);
  });
});
