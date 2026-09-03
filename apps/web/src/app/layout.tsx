import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ServiceWorker from "@/components/ServiceWorker";
import { isNonProductionEnvironment } from "@/lib/preview";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE_METADATA: Metadata = {
  title: {
    default: "Afrinext — apprendre, vendre, construire",
    template: "%s · Afrinext",
  },
  description:
    "La place de marché africaine : formations, produits numériques, produits physiques, " +
    "services, créateurs et livraison. Ouvrez votre boutique en quelques minutes.",
  manifest: "/manifest.webmanifest",
  applicationName: "Afrinext",
  appleWebApp: {
    capable: true,
    title: "Afrinext",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon.png" }],
  },
};

/**
 * A function rather than a constant, so the environment is read per request.
 *
 * The only thing it decides is whether the page carries `noindex`. A preview
 * deployment serves fake prices over a real HTTPS certificate, and the one
 * thing that must not happen is somebody finding it in a search result and
 * taking it for Afrinext. See `lib/preview.ts` for why the payment flag is the
 * test. This is a request to crawlers and nothing more — it is not access
 * control, and it changes no authorization decision anywhere.
 */
export function generateMetadata(): Metadata {
  if (!isNonProductionEnvironment()) return BASE_METADATA;
  return {
    ...BASE_METADATA,
    robots: { index: false, follow: false, nocache: true },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#16110e" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        {/*
          * No width cap and no navigation here.
          *
          * Both belong to the locale layout, which knows the language the tabs
          * must be written in. Capping the width at this level would also make
          * every screen a phone-width strip on a desktop — mobile-FIRST means
          * the phone is the starting point, not the ceiling.
          */}
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
