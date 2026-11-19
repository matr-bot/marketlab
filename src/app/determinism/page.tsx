import type { Metadata } from "next";
import { DeterminismCheck } from "@/components/DeterminismCheck";

export const metadata: Metadata = { title: "MarketLab · determinism check", robots: { index: false } };

/** /determinism (D-091): runs the engine's determinism check in this browser and compares it with the pins. */
export default function DeterminismPage() {
  return <DeterminismCheck />;
}
