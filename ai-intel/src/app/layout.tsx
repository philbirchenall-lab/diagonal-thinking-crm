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
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
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
