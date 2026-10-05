import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const appSans = Manrope({
  variable: "--font-app-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const appMono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL ?? "https://mizigo.netlify.app"),
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
