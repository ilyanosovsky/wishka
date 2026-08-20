import type { Metadata } from "next";

export const SOCIAL_PREVIEW_PATH = "/social/wishka-preview.png";
export const SOCIAL_PREVIEW_WIDTH = 1200;
export const SOCIAL_PREVIEW_HEIGHT = 630;

const LOCAL_APP_URL = "http://localhost:3000";

type MetadataEnv = {
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

/**
 * Metadata URLs must be absolute when a crawler receives them. Production
 * already requires NEXT_PUBLIC_APP_URL at application boot; the Vercel value
 * keeps preview deployments useful, while localhost makes builds and tests
 * deterministic without production configuration.
 */
export function getMetadataBase(
  env: MetadataEnv = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  },
): URL {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return new URL(configured);

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) return new URL(`https://${vercelHost}`);

  return new URL(LOCAL_APP_URL);
}

export function getSocialPreview(description: string) {
  return {
    url: SOCIAL_PREVIEW_PATH,
    width: SOCIAL_PREVIEW_WIDTH,
    height: SOCIAL_PREVIEW_HEIGHT,
    alt: `Wishka — ${description}`,
  } as const;
}

export function getBrandSocialMetadata(
  description: string,
): Pick<Metadata, "openGraph" | "twitter"> {
  const image = getSocialPreview(description);
  return {
    openGraph: {
      type: "website",
      title: "Wishka",
      description,
      siteName: "Wishka",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: "Wishka",
      description,
      images: [image],
    },
  };
}
