import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// Self-hosted variable fonts (from Google Fonts, latin subset) — the build no
// longer depends on reaching fonts.googleapis.com, which made CI builds flaky
// (Turbopack next/font/google fetch failures on hosted runners). Same typefaces
// (Manrope + JetBrains Mono), same weights, deterministic builds.
const appSans = localFont({
  src: "./fonts/Manrope-Variable.woff2",
  variable: "--font-app-sans",
  weight: "400 800",
  display: "swap",
});

const appMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-app-mono",
  weight: "400 600",
  display: "swap",
});

export const metadata: Metadata = {
  // NOTE: do NOT read process.env.URL here — Netlify sets it to
  // http://localhost:3000 during CI builds, which leaked localhost og:image
  // tags into the production HTML. Fall back to the real site URL instead.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://mizigo.netlify.app"),
  title: "Mizigo · Move anything. Anywhere.",
  description:
    "Book the right vehicle for your cargo in Nairobi and track your delivery from pickup to drop-off. Tuk-tuks, pickups, canters and lorries, one app.",
  applicationName: "Mizigo",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Mizigo", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "Mizigo · Move anything. Anywhere.",
    description:
      "Cargo-first booking, price locked before you commit, live tracking and proof of delivery. Nairobi's delivery network — tuk-tuks to 10-tonne lorries.",
    siteName: "Mizigo",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Mizigo — move anything, anywhere in Nairobi" }],
  },
  twitter: { card: "summary_large_image", title: "Mizigo", description: "Book the right vehicle. Track your delivery. Nairobi cargo network." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17181C",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${appSans.variable} ${appMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
