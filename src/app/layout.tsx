import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { cssVariables } from "@/components/terminal/tokens";
import "./globals.css";

// One face per job (D-094), self-hosted by next/font: served from this site, never fetched from Google.
// tokens.ts FONTS turns these into --font-display / --font-sans / --font-mono. Newsreader is not
// preloaded: only the landing page's headline uses it.
const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
const display = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], weight: ["500", "600"], preload: false });

export const metadata: Metadata = {
  title: "MarketLab",
  description:
    "An AI-native market laboratory: simulated traders, a real limit order book, and glass-box strategies.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`} style={cssVariables()}>
      {/* Browser extensions (Grammarly) add attributes to <body> before React hydrates; that is not a bug of ours (D-089). */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
