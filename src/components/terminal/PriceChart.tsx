"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Candle, FrameHeadline } from "@/engine/feed";
import { formatSimTime } from "@/engine/simClock";
import { axisStep, markerCode, priceRange } from "@/lib/chart";
import { formatPrice, formatQty } from "@/lib/format";
import styles from "./terminal.module.css";
import { TOKENS } from "./tokens";

const AXIS_W = 62;
const TIME_H = 16;
const MIN_SLOT = 6; // px per candle: candles widen to fill the panel, up to MAX_SLOT
const MAX_SLOT = 14;
const VOLUME_SHARE = 0.18; // bottom part of the plot used for volume bars
const MARKER_HIT = 5; // px either side of a headline marker that shows its full headline
const DOUBLE_CLICK_MS = 250; // a click waits this long, so the first click of a double-click picks nothing

/** Where everything goes, computed once per render: the drawing and the pointer both use it. */
interface Geometry {
  readonly w: number;
  readonly h: number;
  readonly newest: number;
  readonly slot: number;
  readonly body: number;
  readonly plotW: number;
  readonly plotH: number;
  readonly fits: number;
  readonly visible: readonly Candle[];
  readonly lo: number;
  readonly hi: number;
  readonly priceH: number;
  readonly markers: ReadonlyArray<{ readonly x: number; readonly headline: FrameHeadline }>;
}

/** The chart's layout (D-079), or null when there is nothing to draw yet. Pure: no drawing. */
function layout(w: number, h: number, candles: readonly Candle[], candleMs: number, last: number | null, headlines: readonly FrameHeadline[], zoom: boolean, maxSlot: number): Geometry | null {
  const plotW = w - AXIS_W;
  const plotH = h - TIME_H;
  if (candles.length === 0 || plotW <= maxSlot || plotH <= 20) return null;
  // Candles positioned by time, newest at the right edge; an interval with no trades is a gap.
  const newest = candles[candles.length - 1].start;
  const span = (newest - candles[0].start) / candleMs + 1; // candle slots from the oldest we have to now
  const slot = Math.max(MIN_SLOT, Math.min(maxSlot, Math.floor((plotW - 4) / span)));
  const body = slot - 1 - ((slot - 1) % 2 === 0 ? 1 : 0); // odd, so the wick is centered; a 1-2px gap between bodies
  const fits = Math.floor((plotW - 4) / slot);
  const visible = candles.filter((c) => (newest - c.start) / candleMs < fits);
  const { lo, hi } = priceRange(visible, last, zoom);
  const markers: Array<{ x: number; headline: FrameHeadline }> = [];
  for (const hl of headlines) {
    const ago = (newest - (hl.time - (hl.time % candleMs))) / candleMs;
    if (ago >= 0 && ago < fits) markers.push({ x: Math.round(plotW - slot / 2 - ago * slot - 2) + 0.5, headline: hl });
  }
  return { w, h, newest, slot, body, plotW, plotH, fits, visible, lo, hi, priceH: plotH * (1 - VOLUME_SHARE), markers };
}

/** Pointer position inside the chart, in CSS px. */
interface Hover {
  readonly x: number;
  readonly y: number;
}

/**
 * Price chart (GP, D-079): candles from engine fills with 1px gaps, volume at 25% opacity, a dashed
 * last-price line, headline markers with a short code (hover one for the full headline), and a
 * crosshair with the hovered candle's OHLCV top-left (the latest candle when the pointer is away).
 * Click a candle for WHO; double-click to fit the price axis to the last two minutes, again to reset.
 */
export function PriceChart({
  candles,
  candleMs,
  last,
  headlines,
  selected = null,
  onSelect,
  readout = true,
  maxSlot = MAX_SLOT,
}: {
  candles: readonly Candle[];
  candleMs: number;
  last: number | null;
  headlines: readonly FrameHeadline[];
  /** Start of the candle picked for WHO, or null. */
  selected?: number | null;
  onSelect?: (start: number | null) => void;
  /** The OHLCV readout top-left; off for the small chart in the STRATEGY workspace's corner (D-086). */
  readout?: boolean;
  /** Widest candle slot in px; the landing replay widens it so three minutes fill the chart (D-087). */
  maxSlot?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(false);
  const pendingPick = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(pendingPick.current ?? undefined), []);

  useEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const observer = new ResizeObserver(([entry]) => setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => (size.w === 0 || size.h === 0 ? null : layout(size.w, size.h, candles, candleMs, last, headlines, zoom, maxSlot)), [size, candles, candleMs, last, headlines, zoom, maxSlot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const g = canvas.getContext("2d");
    if (g === null) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = TOKENS.bg;
    g.fillRect(0, 0, size.w, size.h);
    if (geometry !== null) draw(g, geometry, candleMs, last, selected, hover, getComputedStyle(canvas).fontFamily);
  }, [size, geometry, candleMs, last, selected, hover]);

  /** The candle under a pointer x, if there is one. */
  const candleAt = (x: number): Candle | null => {
    const geo = geometry;
    if (geo === null || x >= geo.plotW) return null;
    const ago = Math.round((geo.plotW - geo.slot / 2 - 2 - x) / geo.slot);
    if (ago < 0 || ago >= geo.fits) return null;
    return candles.find((c) => c.start === geo.newest - ago * candleMs) ?? null;
  };

  const local = (e: React.MouseEvent<HTMLDivElement>): Hover => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Click a candle to see who traded in it (WHO, D-054); click it again to go back to live. The pick waits
  // DOUBLE_CLICK_MS, so a double-click (the zoom) picks nothing.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (onSelect === undefined || e.detail > 1) return;
    const c = candleAt(local(e).x);
    if (c === null) return;
    clearTimeout(pendingPick.current ?? undefined);
    pendingPick.current = setTimeout(() => onSelect(c.start === selected ? null : c.start), DOUBLE_CLICK_MS);
  };
  const onDoubleClick = () => {
    clearTimeout(pendingPick.current ?? undefined);
    setZoom((z) => !z);
  };

  const hovered = hover === null ? null : candleAt(hover.x);
  const shown = hovered ?? candles.at(-1) ?? null;
  const marker = hover === null || geometry === null ? null : (geometry.markers.find((m) => Math.abs(m.x - hover.x) <= MARKER_HIT && hover.y <= geometry.plotH) ?? null);

  return (
    <div
      ref={boxRef}
      className={styles.chart}
      data-testid="chart"
      data-markers={headlines.map((h) => h.code).join("|")}
      data-selected={selected ?? ""}
      data-zoom={zoom ? "2m" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseMove={(e) => setHover(local(e))}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} aria-label="Price chart: click a candle to see who traded in it; double-click to zoom the price axis to the last two minutes" role="img" />
      {readout && shown !== null && (
        <div className={styles.ohlcv} data-testid="chart-ohlcv" data-start={shown.start}>
          <span className={styles.bigFigure}>{formatSimTime(shown.start).slice(0, 8)}</span>
          <span>
            <span className={styles.bigFigure}>O</span> {formatPrice(shown.open)}
          </span>
          <span>
            <span className={styles.bigFigure}>H</span> {formatPrice(shown.high)}
          </span>
          <span>
            <span className={styles.bigFigure}>L</span> {formatPrice(shown.low)}
          </span>
          <span className={shown.close > shown.open ? styles.up : shown.close < shown.open ? styles.down : undefined}>
            <span className={styles.bigFigure}>C</span> {formatPrice(shown.close)}
          </span>
          <span>
            <span className={styles.bigFigure}>V</span> {formatQty(shown.volume)}
          </span>
          {zoom && <span className={styles.bigFigure}>Y 2M</span>}
        </div>
      )}
      {marker !== null && (
        <div className={styles.markerTip} data-testid="chart-marker-tip" style={{ left: Math.min(marker.x + 6, Math.max(0, (geometry?.plotW ?? 0) - 320)) }}>
          <span className={styles.bigFigure}>{formatSimTime(marker.headline.time).slice(0, 8)}</span> {marker.headline.headline}
        </div>
      )}
    </div>
  );
}

function draw(g: CanvasRenderingContext2D, geo: Geometry, candleMs: number, last: number | null, selected: number | null, hover: Hover | null, font: string) {
  const { w, h, newest, slot, body, plotW, plotH, fits, visible, lo, hi, priceH, markers } = geo;
  g.font = `11px ${font}`;
  g.textBaseline = "middle";
  const xOf = (c: Candle) => plotW - slot / 2 - ((newest - c.start) / candleMs) * slot - 2;
  const yOf = (p: number) => 4 + ((hi - p) / (hi - lo)) * (priceH - 8);

  // Grid and price labels at round steps: about 12, fewer on a short chart.
  const step = axisStep(lo, hi, Math.max(3, Math.floor(priceH / 24))); // at most one label per 24px of height
  g.strokeStyle = TOKENS.grid;
  g.lineWidth = 1;
  g.fillStyle = TOKENS.label;
  g.textAlign = "right";
  // An axis label the last-price or crosshair tag (14px tall) would cover is not drawn (D-071).
  const lastY = last === null ? null : Math.round(yOf(last)) + 0.5;
  const hoverY = hover !== null && hover.x < plotW && hover.y < priceH ? hover.y : null;
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const y = Math.round(yOf(p)) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(plotW, y);
    g.stroke();
    if ((lastY === null || Math.abs(y - lastY) >= 14) && (hoverY === null || Math.abs(y - hoverY) >= 14)) g.fillText(formatPrice(p), w - 4, y);
  }

  // Time labels on whole minutes.
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = TOKENS.label;
  for (const c of visible) {
    if (c.start % 60_000 !== 0) continue;
    const x = Math.round(xOf(c)) + 0.5;
    g.strokeStyle = TOKENS.grid;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, plotH);
    g.stroke();
    g.fillText(formatSimTime(c.start).slice(0, 5), x, h - 3);
  }

  // Volume bars: neutral, 25% opacity (green and red are for price direction only).
  const maxVol = Math.max(...visible.map((c) => c.volume));
  g.globalAlpha = 0.25;
  g.fillStyle = TOKENS.data;
  for (const c of visible) {
    const vh = (c.volume / maxVol) * (plotH * VOLUME_SHARE - 4);
    g.fillRect(Math.round(xOf(c)) - (body - 1) / 2, plotH - vh, body, vh);
  }
  g.globalAlpha = 1;

  // Candles: wick, then body. Up green, down red, unchanged white. Clipped to the price area.
  g.save();
  g.beginPath();
  g.rect(0, 0, plotW, priceH);
  g.clip();
  for (const c of visible) {
    const x = Math.round(xOf(c));
    g.fillStyle = c.close > c.open ? TOKENS.up : c.close < c.open ? TOKENS.down : TOKENS.data;
    const top = yOf(c.high);
    g.fillRect(x, top, 1, Math.max(1, yOf(c.low) - top));
    const bodyTop = yOf(Math.max(c.open, c.close));
    g.fillRect(x - (body - 1) / 2, bodyTop, body, Math.max(1, yOf(Math.min(c.open, c.close)) - bodyTop));
  }
  g.restore();

  // Headline markers: a thin vertical line at the candle the headline arrived in, its short code on top.
  g.textAlign = "left";
  g.textBaseline = "top";
  for (const { x, headline: hl } of markers) {
    g.strokeStyle = TOKENS.label;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, plotH);
    g.stroke();
    const label = markerCode(hl.code);
    const tw = g.measureText(label).width + 6;
    const left = x + 1 + tw > plotW ? x - tw : x + 1; // near the axis, put the label left of the line
    g.fillStyle = TOKENS.border;
    g.fillRect(left, 20, tw, 14);
    g.fillStyle = TOKENS.data;
    g.fillText(label, left + 3, 21);
  }

  // The candle picked for WHO: a thin white frame around its slot.
  if (selected !== null && (newest - selected) / candleMs < fits) {
    const x = Math.round(plotW - slot / 2 - ((newest - selected) / candleMs) * slot - 2);
    g.strokeStyle = TOKENS.data;
    g.strokeRect(x - slot / 2 + 0.5, 0.5, slot - 1, plotH - 1);
  }

  // Last price: a dashed line and its value on the axis.
  if (last !== null && lastY !== null) {
    g.strokeStyle = TOKENS.label;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(0, lastY);
    g.lineTo(plotW, lastY);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = TOKENS.data;
    g.fillRect(plotW + 1, lastY - 7, AXIS_W - 1, 14);
    g.fillStyle = TOKENS.bg;
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillText(formatPrice(last), w - 4, lastY);
  }

  // Crosshair: thin gray lines through the pointer, and the price under it on the axis.
  if (hover !== null && hover.x < plotW && hover.y < plotH) {
    g.strokeStyle = TOKENS.label;
    g.setLineDash([1, 2]);
    g.beginPath();
    g.moveTo(Math.round(hover.x) + 0.5, 0);
    g.lineTo(Math.round(hover.x) + 0.5, plotH);
    if (hoverY !== null) {
      g.moveTo(0, Math.round(hoverY) + 0.5);
      g.lineTo(plotW, Math.round(hoverY) + 0.5);
    }
    g.stroke();
    g.setLineDash([]);
    if (hoverY !== null) {
      const price = Math.round(hi - ((hoverY - 4) / (priceH - 8)) * (hi - lo));
      g.fillStyle = TOKENS.border;
      g.fillRect(plotW + 1, hoverY - 7, AXIS_W - 1, 14);
      g.fillStyle = TOKENS.data;
      g.textAlign = "right";
      g.textBaseline = "middle";
      g.fillText(formatPrice(price), w - 4, hoverY);
    }
  }

  // Axis border.
  g.strokeStyle = TOKENS.border;
  g.beginPath();
  g.moveTo(plotW + 0.5, 0);
  g.lineTo(plotW + 0.5, plotH);
  g.lineTo(0, plotH + 0.5);
  g.stroke();
}
