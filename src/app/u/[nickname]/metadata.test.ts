import { afterEach, describe, expect, it, vi } from "vitest";

import { SOCIAL_PREVIEW_PATH } from "@/lib/metadata";

/**
 * §6.8 share card for a public list. The privacy and fallback rules are pinned
 * here because they are easy to regress while polishing messenger previews:
 *  - the unknown-nickname fallback must be an *absolute* title, or the root
 *    layout's `%s · Wishka` template renders "Wishka · Wishka";
 *  - only an image on our own storage may replace the branded fallback in
 *    `og:image`/`twitter:image`.
 *    `user.image` is a hotlinked `lh3.googleusercontent.com` URL for anyone
 *    who signed in with Google and never uploaded an avatar (invariant #6 has
 *    re-hosting as a backlog item), and a share card is the one place that URL
 *    would be published to third parties.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "ru",
  getTranslations: async () => (key: string) => key,
}));

const getPublicIdentityByNickname = vi.fn();
vi.mock("@/db/access/public-identity", () => ({
  getPublicIdentityByNickname: (db: unknown, nickname: string) =>
    getPublicIdentityByNickname(db, nickname),
  getPublicIdentityByUserId: vi.fn(),
}));

async function metadataFor(nickname: string) {
  const { generateMetadata } = await import("./page");
  return generateMetadata({ params: Promise.resolve({ nickname }) });
}

const OURS = "https://app123.ufs.sh/f/avatar-masha";
const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocK";

afterEach(() => {
  vi.clearAllMocks();
});

describe("/u/[nickname] share card", () => {
  it("uses an absolute title for an unknown nickname, never the %s template", async () => {
    getPublicIdentityByNickname.mockResolvedValue(null);
    const meta = await metadataFor("nobody");
    expect(meta.title).toEqual({ absolute: "Wishka" });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: SOCIAL_PREVIEW_PATH }),
    ]);
  });

  it("publishes an avatar that lives on our own storage", async () => {
    getPublicIdentityByNickname.mockResolvedValue({
      userId: "u1",
      nickname: "masha",
      name: "Маша",
      image: OURS,
    });
    const meta = await metadataFor("masha");
    expect(meta.title).toBe("Маша");
    expect(meta.openGraph?.images).toEqual([OURS]);
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      images: [OURS],
    });
  });

  it("never leaks an external (Google OAuth) avatar into the card", async () => {
    getPublicIdentityByNickname.mockResolvedValue({
      userId: "u1",
      nickname: "masha",
      name: "Маша",
      image: GOOGLE,
    });
    const meta = await metadataFor("masha");
    expect(meta.openGraph?.images).toEqual([
      expect.objectContaining({ url: SOCIAL_PREVIEW_PATH }),
    ]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    expect(JSON.stringify(meta)).not.toContain("googleusercontent");
  });

  it("falls back to the nickname when the owner has no name", async () => {
    getPublicIdentityByNickname.mockResolvedValue({
      userId: "u1",
      nickname: "wisher-3f2a91cc",
      name: null,
      image: null,
    });
    const meta = await metadataFor("wisher-3f2a91cc");
    // Never `" · Wishka"` — the template needs something to interpolate.
    expect(meta.title).toBe("wisher-3f2a91cc");
    expect(meta.openGraph?.title).toBe("wisher-3f2a91cc");
  });
});
