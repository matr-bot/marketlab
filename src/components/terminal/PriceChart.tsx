"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { formatPrice } from "@/lib/format";
import styles from "./terminal.module.css";
import { COLORS } from "./theme";

const AXIS_W = 62;
const TIME_H = 16;
const MIN_SLOT = 6; // px per candle: candles widen to fill the panel, up to MAX_SLOT
const MAX_SLOT = 14;
const MIN_RANGE = 10; // cents shown at least, so a quiet market is not blown up to full height
const VOLUME_SHARE = 0.18; // bottom part of the plot used for volume bars
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000];

/** Price chart (GP): candles from engine fills, volume bars, and the last price on the axis. */
export function PriceChart({ candles, candleMs, last }: { candles: readonly Candle[]; candleMs: number; last: number | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const g = canvas.getContext("2d");
    if (g === null) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(g, size.w, size.h, candles, candleMs, last, getComputedStyle(canvas).fontFamily);
  }, [size, candles, candleMs, last]);

  return (
    <div ref={boxRef} className={styles.chart} data-testid="chart">
      <canvas ref={canvasRef} aria-label="Price chart" role="img" />
    </div>
  );
}

function draw(g: CanvasRenderingContext2D, w: number, h: number, candles: readonly Candle[], candleMs: number, last: number | null, font: string) {
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, w, h);
  const plotW = w - AXIS_W;
  const plotH = h - TIME_H;
  if (candles.length === 0 || plotW <= MAX_SLOT || plotH <= 20) return;
  g.font = `11px ${font}`;
  g.textBaseline = "middle";

  // Candles positioned by time, newest at the right edge; an interval with no trades is a gap.
  const newest = candles[candles.length - 1].start;
  const span = (newest - candles[0].start) / candleMs + 1; // candle slots from the oldest we have to now
  const slot = Math.max(MIN_SLOT, Math.min(MAX_SLOT, Math.floor((plotW - 4) / span)));
  const body = Math.max(3, slot - 3 - ((slot - 3) % 2 === 0 ? 1 : 0)); // odd, so the wick is centered
  const fits = Math.floor((plotW - 4) / slot);
  const visible = candles.filter((c) => (newest - c.start) / candleMs < fits);
  const xOf = (c: Candle) => plotW - slot / 2 - ((newest - c.start) / candleMs) * slot - 2;

  let lo = Math.min(...visible.map((c) => c.low));
  let hi = Math.max(...visible.map((c) => c.high));
  if (last !== null) {
    lo = Math.min(lo, last);
    hi = Math.max(hi, last);
  }
  if (hi - lo < MIN_RANGE) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_RANGE / 2;
    hi = mid + MIN_RANGE / 2;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const priceH = plotH * (1 - VOLUME_SHARE);
  const yOf = (p: number) => 4 + ((hi - p) / (hi - lo)) * (priceH - 8);

  // Grid and price labels at round steps.
  const step = STEPS.find((s) => (hi - lo) / s <= 7) ?? STEPS[STEPS.length - 1];
  g.strokeStyle = COLORS.grid;
  g.lineWidth = 1;
  g.fillStyle = COLORS.white;
  g.textAlign = "right";
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const y = Math.round(yOf(p)) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(plotW, y);
    g.stroke();
    g.fillText(formatPrice(p), w - 4, y);
  }

  // Time labels on whole minutes.
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = COLORS.amber;
  for (const c of visible) {
    if (c.start % 60_000 !== 0) continue;
    const x = Math.round(xOf(c)) + 0.5;
    g.strokeStyle = COLORS.grid;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, plotH);
    g.stroke();
    g.fillText(formatSimTime(c.start).slice(0, 5), x, h - 3);
  }

  // Volume bars (neutral: green and red are for price direction only).
  const maxVol = Math.max(...visible.map((c) => c.volume));
  g.fillStyle = COLORS.border;
  for (const c of visible) {
    const vh = (c.volume / maxVol) * (plotH * VOLUME_SHARE - 4);
    g.fillRect(Math.round(xOf(c)) - (body - 1) / 2, plotH - vh, body, vh);
  }

  // Candles: wick, then body. Up green, down red, unchanged white.
  for (const c of visible) {
    const x = Math.round(xOf(c));
    g.fillStyle = c.close > c.open ? COLORS.up : c.close < c.open ? COLORS.down : COLORS.white;
    const top = yOf(c.high);
    g.fillRect(x, top, 1, Math.max(1, yOf(c.low) - top));
    const bodyTop = yOf(Math.max(c.open, c.close));
    g.fillRect(x - (body - 1) / 2, bodyTop, body, Math.max(1, yOf(Math.min(c.open, c.close)) - bodyTop));
  }

  // Last price: a thin solid line and its value on the axis.
  if (last !== null) {
    const y = Math.round(yOf(last)) + 0.5;
    g.strokeStyle = COLORS.amber;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(plotW, y);
    g.stroke();
    g.fillStyle = COLORS.amber;
    g.fillRect(plotW + 1, y - 7, AXIS_W - 1, 14);
    g.fillStyle = COLORS.bg;
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillText(formatPrice(last), w - 4, y);
  }

  // Axis border.
  g.strokeStyle = COLORS.border;
  g.beginPath();
  g.moveTo(plotW + 0.5, 0);
  g.lineTo(plotW + 0.5, plotH);
  g.lineTo(0, plotH + 0.5);
  g.stroke();
}
