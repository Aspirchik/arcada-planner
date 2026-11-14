/** Cable polyline helpers (pure) */
import type { Cable, FurnitureItem, Tray } from '../types';
import type { FloorWallGeom } from './walls';
import type { WallLabelMode } from '../prefs';
import { rectCorners } from './hit';
import { distToSegment, type Pt } from './hit';
import { formatMeters, wallLabelSpecs, LABEL_SIZE } from './wallLabels';

export function pathLength(points: Pt[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** Point at a fraction (0…1) of the polyline length and the direction of the segment there (degrees) */
export function pointAlong(points: Pt[], fraction: number): { p: Pt; angle: number } {
  const target = pathLength(points) * fraction;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= target && seg > 0) {
      const t = (target - acc) / seg;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
    }
    acc += seg;
  }
  return { p: points[0] ?? { x: 0, y: 0 }, angle: 0 };
}

/** Point halfway along the polyline */
export function midAlong(points: Pt[]): { p: Pt; angle: number } {
  return pointAlong(points, 0.5);
}

/** Text shown along the cable: its label, route (from → to) and/or length */
export function cableLabel(c: Cable, unitM: string): string {
  const parts: string[] = [];
  if (c.label?.trim()) parts.push(c.label.trim());
  const route = c.route !== undefined ? c.route : cableRoute(c);
  if (route) parts.push(route);
  if (c.showLength) parts.push(formatMeters(cableLength(c), unitM));
  return parts.join(' · ');
}

/** Length shown for a cable: the whole chain for its first cable */
export const cableLength = (c: Cable) => c.totalLength ?? pathLength(c.points);

/** Route shown for a cable (the chain route on its first cable, nothing on the others) */
export const cableRouteText = (c: Cable) => (c.route !== undefined ? c.route : cableRoute(c));

/** Index of the segment (i → i+1) closest to p within `thr`, or -1 */
export function hitSegment(points: Pt[], p: Pt, thr: number): number {
  let best = -1, bestD = thr;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(p.x, p.y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    if (d < bestD) { bestD = d; best = i - 1; }
  }
  return best;
}

/** Index of the vertex closest to p within `thr`, or -1 */
export function hitVertex(points: Pt[], p: Pt, thr: number): number {
  let best = -1, bestD = thr;
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Removes consecutive duplicate points (e.g. from a double-click that finishes the cable) */
export function dedupePoints(points: Pt[], eps = 0.5): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) out.push(p);
  }
  return out;
}

// ── Bundling: cables running along the same path are drawn side by side ──

const ANGLE_EPS = 0.02;   // rad — segments this close in direction count as parallel
const LINE_EPS = 4;       // cm  — and this close sideways count as the same run
const MIN_OVERLAP = 1;    // cm  — shared length needed to bundle
const GAP = 1.5;          // cm  — space between bundled cables

interface Seg { cable: number; index: number; a: Pt; b: Pt; ang: number; u: Pt; n: Pt; c: number; t0: number; t1: number; width: number }

function segmentsOf(cables: Cable[]): Seg[] {
  const out: Seg[] = [];
  cables.forEach((cb, ci) => {
    for (let i = 1; i < cb.points.length; i++) {
      const a = cb.points[i - 1], b = cb.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      let ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      let ang = Math.atan2(uy, ux);
      // Canonical direction (0 ≤ angle < π) so opposite directions share the same line key
      if (ang < 0 || ang >= Math.PI - 1e-9) { ux = -ux; uy = -uy; ang = Math.atan2(uy, ux); if (ang < 0) ang += Math.PI; }
      const n = { x: -uy, y: ux };
      const ta = a.x * ux + a.y * uy, tb = b.x * ux + b.y * uy;
      out.push({ cable: ci, index: i - 1, a, b, ang, u: { x: ux, y: uy }, n, c: n.x * a.x + n.y * a.y, t0: Math.min(ta, tb), t1: Math.max(ta, tb), width: cb.width ?? 3 });
    }
  });
  return out;
}

function sameRun(s1: Seg, s2: Seg): boolean {
  let d = Math.abs(s1.ang - s2.ang);
  d = Math.min(d, Math.PI - d);
  if (d > ANGLE_EPS) return false;
  if (Math.abs(s1.c - s2.c) > LINE_EPS) return false;
  return Math.min(s1.t1, s2.t1) - Math.max(s1.t0, s2.t0) > MIN_OVERLAP;
}

/**
 * Display paths for all cables: where several cables share a run, each gets its own lane
 * (offset sideways, ordered as in the list), joined with clean corners. Cables alone keep their points.
 */
export function layoutCables(cables: Cable[]): Map<number, Pt[]> {
  const segs = segmentsOf(cables);
  // Offset vector for every (cable, segment index)
  const offsets = new Map<string, Pt>();
  for (const s1 of segs) {
    const group = new Set<number>([s1.cable]);
    let maxW = s1.width;
    for (const s2 of segs) {
      if (s2.cable !== s1.cable && sameRun(s1, s2)) { group.add(s2.cable); maxW = Math.max(maxW, s2.width); }
    }
    if (group.size < 2) continue;
    const order = [...group].sort((x, y) => x - y);
    const lane = order.indexOf(s1.cable) - (order.length - 1) / 2;
    const o = lane * (maxW + GAP);
    offsets.set(`${s1.cable}:${s1.index}`, { x: s1.n.x * o, y: s1.n.y * o });
  }

  const result = new Map<number, Pt[]>();
  cables.forEach((cb, ci) => {
    const pts = cb.points;
    if (pts.length < 2) { result.set(cb.id, pts); return; }
    const off = (i: number): Pt => offsets.get(`${ci}:${i}`) ?? { x: 0, y: 0 };
    if (![...Array(pts.length - 1).keys()].some(i => offsets.has(`${ci}:${i}`))) { result.set(cb.id, pts); return; }

    const out: Pt[] = [{ x: pts[0].x + off(0).x, y: pts[0].y + off(0).y }];
    for (let i = 1; i < pts.length - 1; i++) {
      const o1 = off(i - 1), o2 = off(i);
      const a1 = { x: pts[i - 1].x + o1.x, y: pts[i - 1].y + o1.y }, d1 = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y };
      const a2 = { x: pts[i].x + o2.x, y: pts[i].y + o2.y }, d2 = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y };
      const den = d1.x * d2.y - d1.y * d2.x;
      const jog = () => {
        out.push({ x: pts[i].x + o1.x, y: pts[i].y + o1.y });
        if (Math.hypot(o1.x - o2.x, o1.y - o2.y) > 0.01) out.push({ x: pts[i].x + o2.x, y: pts[i].y + o2.y });
      };
      if (Math.abs(den) < 1e-9) { jog(); continue; }
      const t = ((a2.x - a1.x) * d2.y - (a2.y - a1.y) * d2.x) / den;
      const q = { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
      const limit = 3 * (Math.hypot(o1.x, o1.y) + Math.hypot(o2.x, o2.y)) + 1;
      if (Math.hypot(q.x - pts[i].x, q.y - pts[i].y) > limit) jog();
      else out.push(q);
    }
    const last = pts.length - 1;
    out.push({ x: pts[last].x + off(last - 1).x, y: pts[last].y + off(last - 1).y });
    result.set(cb.id, out);
  });
  return result;
}

// ── Label placement without overlaps ──

const FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];

export interface Box { x0: number; y0: number; x1: number; y1: number }
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Where to put each cable label: the first spot along the cable (middle first) that doesn't
 * cover a label already placed. `size` is the font size, `measure` the text width.
 */
export function placeCableLabels(
  cables: Cable[], paths: Map<number, Pt[]>, labels: Map<number, string>, size: number,
  measure: (text: string) => number,
  avoid: Box[] = [],
): Map<number, { p: Pt; angle: number }> {
  const placed: Box[] = [...avoid];
  const out = new Map<number, { p: Pt; angle: number }>();
  for (const c of cables) {
    const text = labels.get(c.id);
    const path = paths.get(c.id) ?? c.points;
    if (!text || path.length < 2) continue;
    const w = measure(text), h = size;
    const off = (c.width ?? 3) / 2 + size / 2 + 2;
    let best: { p: Pt; angle: number; box: Box; score: number } | null = null;
    for (const f of FRACTIONS) {
      const at = pointAlong(path, f);
      const rad = at.angle * Math.PI / 180;
      const ux = Math.cos(rad), uy = Math.sin(rad);
      const nx = -uy, ny = ux;
      const side = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
      const p = { x: at.p.x + nx * off * side, y: at.p.y + ny * off * side };
      const hx = Math.abs(ux) * w / 2 + Math.abs(nx) * h / 2, hy = Math.abs(uy) * w / 2 + Math.abs(ny) * h / 2;
      const box = { x0: p.x - hx, y0: p.y - hy, x1: p.x + hx, y1: p.y + hy };
      const score = placed.reduce((s, b) => s + overlap(box, b), 0);
      if (!best || score < best.score) best = { p, angle: at.angle, box, score };
      if (score === 0) break;
    }
    if (best) { placed.push(best.box); out.set(c.id, { p: best.p, angle: best.angle }); }
  }
  return out;
}

/**
 * Areas cable labels should stay away from: wall length labels and small equipment
 * (sockets, entry points, switches — items on the upper layers).
 */
export function labelObstacles(geom: FloorWallGeom, mode: WallLabelMode, furniture: FurnitureItem[]): Box[] {
  const out: Box[] = [];
  const textW = 6 * LABEL_SIZE * 0.55; // "0.00 m"
  for (const g of geom.walls) {
    for (const l of wallLabelSpecs(g, mode)) {
      const rad = l.angle * Math.PI / 180;
      const hx = Math.abs(Math.cos(rad)) * textW / 2 + Math.abs(Math.sin(rad)) * LABEL_SIZE / 2;
      const hy = Math.abs(Math.sin(rad)) * textW / 2 + Math.abs(Math.cos(rad)) * LABEL_SIZE / 2;
      out.push({ x0: l.p.x - hx, y0: l.p.y - hy, x1: l.p.x + hx, y1: l.p.y + hy });
    }
  }
  for (const f of furniture) {
    if (f.zi < 150 || f.w * f.h > 5000) continue;
    const c = rectCorners(f.x, f.y, f.w, f.h, f.rot);
    out.push({ x0: Math.min(...c.map(p => p.x)), y0: Math.min(...c.map(p => p.y)), x1: Math.max(...c.map(p => p.x)), y1: Math.max(...c.map(p => p.y)) });
  }
  return out;
}

// ── Trays ──

/** Shortest distance from p to the polyline */
export function distToPath(points: Pt[], p: Pt): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++)
    best = Math.min(best, distToSegment(p.x, p.y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y));
  return best;
}

/** Length of the cable that runs inside the tray band (sampled every `step` cm) */
export function lengthInTray(cable: Pt[], tray: Tray, step = 5): number {
  const half = tray.width / 2 + 2; // a little tolerance for cables on the tray edge
  let inside = 0;
  for (let i = 1; i < cable.length; i++) {
    const a = cable[i - 1], b = cable[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (distToPath(tray.points, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) <= half) inside += len / n;
    }
  }
  return inside;
}

/** Cables that run in the tray for at least `minLength` cm, in list order */
export function cablesInTray(tray: Tray, cables: Cable[], minLength = 20): Cable[] {
  return cables.filter(c => lengthInTray(c.points, tray) >= minLength);
}

/** "from → to" for a cable, or '' */
export function cableRoute(c: Cable): string {
  const from = c.from?.trim(), to = c.to?.trim();
  if (!from && !to) return '';
  if (!from) return `→ ${to}`;
  if (!to) return `${from} →`;
  return `${from} → ${to}`;
}
