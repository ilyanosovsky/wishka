import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Literata, Newsreader } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { OfflineBanner } from "@/components/offline-banner";
import { getBrandSocialMetadata, getMetadataBase } from "@/lib/metadata";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin", "cyrillic"],
  variable: "--font-literata",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  const description = t("meta.description");
  return {
    metadataBase: getMetadataBase(),
    title: { default: "Wishka", template: "%s · Wishka" },
    description,
    applicationName: "Wishka",
    ...getBrandSocialMetadata(description),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Verbatim from src/styles/tokens.css `--bg` (light `:root` / dark
  // `[data-theme="dark"]`) so mobile browser chrome matches the app shell.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e9" },
    { media: "(prefers-color-scheme: dark)", color: "#1f1c16" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${newsreader.variable} ${literata.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Sets data-theme before paint — prevents a wrong-theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <OfflineBanner />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
