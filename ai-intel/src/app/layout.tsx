import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Intelligence — Diagonal Thinking",
  description: "Diagonal Thinking internal AI intelligence wiki.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
