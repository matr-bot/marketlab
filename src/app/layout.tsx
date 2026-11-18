import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { cssVariables } from "@/components/terminal/tokens";
import "./globals.css";

// One monospace font everywhere (D-078), self-hosted by next/font: served from this site, never fetched from Google.
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MarketLab",
  description:
    "An AI-native market laboratory: simulated traders, a real limit order book, and glass-box strategies.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={mono.variable} style={cssVariables()}>
      <body>{children}</body>
    </html>
  );
}
