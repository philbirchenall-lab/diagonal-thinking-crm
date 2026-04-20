import type { Metadata } from "next";
import { Oswald, Source_Sans_3 } from "next/font/google";
import "./globals.css";

// DT brand display face. Free via Google Fonts, no licence friction.
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-oswald",
  display: "swap",
});

// Body face. Source Sans 3 is the interim per Tes scope Ambiguity A
// (Phil confirmed 17 Apr). Adobe Typekit for Omnes Pro is a separate
// follow-up PR once Phil provides the kit ID.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Intelligence | Diagonal Thinking",
  description: "Diagonal Thinking internal wiki. Sign in to continue.",
    icons: {
          icon: [
            { url: "/favicon.ico", sizes: "32x32" },
            { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
            { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
            { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
                ],
          apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
          other: [
            {
                      rel: "icon",
                      url: "/maskable-512.png",
                      sizes: "512x512",
                      type: "image/png",
            },
                ],
    },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${oswald.variable} ${sourceSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
