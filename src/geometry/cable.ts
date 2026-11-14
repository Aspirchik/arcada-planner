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

/** Nearest point of a polyline to p, and the distance along the polyline to it */
export function projectOnPath(points: Pt[], p: Pt): { p: Pt; along: number; dist: number } {
  let best = { p: points[0] ?? p, along: 0, dist: Infinity };
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.dist) best = { p: q, along: acc + Math.sqrt(len2) * t, dist: d };
    acc += Math.sqrt(len2);
  }
  return best;
}

const BIG = 1e6;

/**
 * Display paths for all cables. Where several cables share a run (a "corridor": parallel segments on one line
 * that overlap, directly or through each other), every cable keeps one lane along the whole corridor, so lanes
 * don't jump when a cable leaves. Lanes are ordered so cables turning off to one side lie on that side and the
 * one turning first is outermost — they leave the bundle without crossing it. Offset ends get a short straight
 * lead back to the real end (the centre of a socket); a continuation starts on its parent's drawn line.
 * With `groupOrder` (cable group ids, first = outermost), cables of one group lie together, the first group
 * on the outer side of the bundle (away from the middle of the drawing, i.e. along the wall).
 */
export function layoutCables(cables: Cable[], groupOrder: number[] = []): Map<number, Pt[]> {
  const segs = segmentsOf(cables);
  // Middle of the drawing: the outer side of a bundle is the side away from it
  const all = cables.flatMap(c => c.points);
  const mid = all.length ? { x: all.reduce((s, p) => s + p.x, 0) / all.length, y: all.reduce((s, p) => s + p.y, 0) / all.length } : { x: 0, y: 0 };

  // Corridors: union of overlapping parallel segments of different cables on the same line
  const parent = segs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      if (segs[i].cable !== segs[j].cable && sameRun(segs[i], segs[j])) parent[find(i)] = find(j);
  const corridors = new Map<number, Seg[]>();
  segs.forEach((sg, i) => {
    const r = find(i);
    corridors.set(r, [...(corridors.get(r) ?? []), sg]);
  });

  // Which side (along n) the path goes from a corridor end: +1 / -1, 0 when the cable ends there
  const sideAt = (ci: number, pointIdx: number, otherIdx: number, n: Pt): number => {
    const pts = cables[ci].points;
    const q = pts[otherIdx];
    if (!q) return 0;
    const d = (q.x - pts[pointIdx].x) * n.x + (q.y - pts[pointIdx].y) * n.y;
    return Math.abs(d) < 0.5 ? 0 : Math.sign(d);
  };

  // A chain (cable + its continuations) is one line: it keeps one lane
  const idx = new Map(cables.map((c, i) => [c.id, i]));
  const lineOf = (ci: number): number => {
    let cur = ci;
    const seen = new Set([ci]);
    for (;;) {
      const up = cables[cur].parent !== undefined ? idx.get(cables[cur].parent!) : undefined;
      if (up === undefined || seen.has(up)) return cur;
      seen.add(up);
      cur = up;
    }
  };

  const offsets = new Map<string, Pt>();
  for (const list of corridors.values()) {
    const lines = [...new Set(list.map(sg => lineOf(sg.cable)))];
    if (lines.length < 2) continue;
    const n = list[0].n;
    const maxW = Math.max(...list.map(sg => sg.width));
    const corrLo = Math.min(...list.map(sg => sg.t0)), corrHi = Math.max(...list.map(sg => sg.t1));
    const score = new Map<number, number>();
    for (const line of lines) {
      const own = list.filter(sg => lineOf(sg.cable) === line);
      const lo = Math.min(...own.map(sg => sg.t0)), hi = Math.max(...own.map(sg => sg.t1));
      // Where the line turns off the corridor, and to which side
      const exits: { t: number; side: number }[] = [];
      for (const sg of own) {
        const ta = sg.a.x * sg.u.x + sg.a.y * sg.u.y, tb = sg.b.x * sg.u.x + sg.b.y * sg.u.y;
        const sa = sideAt(sg.cable, sg.index, sg.index - 1, n), sb = sideAt(sg.cable, sg.index + 1, sg.index + 2, n);
        if (sa) exits.push({ t: ta, side: sa });
        if (sb) exits.push({ t: tb, side: sb });
      }
      // The line comes in at the corridor end it shares with others (the common start, e.g. the entry point)
      const fromLo = lo - corrLo <= 5 || corrHi - hi > 5;
      const away = exits.filter(e => (fromLo ? e.t > lo + 0.5 : e.t < hi - 0.5));
      const first = away.sort((a, b) => (fromLo ? a.t - b.t : b.t - a.t))[0];
      // The first to turn off goes outermost on its side, so it leaves without crossing the others
      score.set(line, first ? first.side * (BIG - (fromLo ? first.t - corrLo : corrHi - first.t)) : 0);
    }
    // Group rank of a line (a chain shares the groups of its first cable); no group = after all groups
    const rank = (line: number) => {
      const r = Math.min(...(cables[line].groups ?? []).map(g => groupOrder.indexOf(g)).filter(i => i >= 0));
      return Number.isFinite(r) ? r : groupOrder.length;
    };
    const at = list[0].a;
    const outerPlus = (at.x - mid.x) * n.x + (at.y - mid.y) * n.y > 0;
    const order = lines.sort((x, y) => (outerPlus ? rank(y) - rank(x) : rank(x) - rank(y)) || score.get(x)! - score.get(y)! || x - y);
    for (const sg of list) {
      const o = (order.indexOf(lineOf(sg.cable)) - (order.length - 1) / 2) * (maxW + GAP);
      offsets.set(`${sg.cable}:${sg.index}`, { x: n.x * o, y: n.y * o });
    }
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
    const end = { x: pts[last].x + off(last - 1).x, y: pts[last].y + off(last - 1).y };
    out.push(end);
    // Short straight leads from the lane to the real ends (e.g. the centre of a socket)
    if (Math.hypot(end.x - pts[last].x, end.y - pts[last].y) > 0.01) out.push({ ...pts[last] });
    if (cb.parent === undefined && Math.hypot(out[0].x - pts[0].x, out[0].y - pts[0].y) > 0.01) out.unshift({ ...pts[0] });
    result.set(cb.id, out);
  });

  // Continuations start on the drawn line of their parent (which may be in a lane of a bundle)
  const byId = new Map(cables.map(c => [c.id, c]));
  for (const c of cables) {
    if (c.parent === undefined) continue;
    const up = byId.get(c.parent);
    const path = result.get(c.id), upPath = up && result.get(up.id);
    if (!up || !path || !upPath || projectOnPath(up.points, c.points[0]).dist > 1) continue;
    const q = projectOnPath(upPath, path[0]).p;
    if (Math.hypot(q.x - path[0].x, q.y - path[0].y) > 0.01) result.set(c.id, [q, ...path]);
  }
  return result;
}

// ── Label placement without overlaps ──

const FRACTIONS = [0.5, 0.3, 0.7, 0.15, 0.85];

export interface Box { x0: number; y0: number; x1: number; y1: number }
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Where to put each cable label: on a straight part long enough for the text (longest first, its middle first),
 * on either side of the line, where it doesn't cover a label already placed or an obstacle.
 * A chain's label may go on any of its cables. `size` is the font size, `measure` the text width.
 */
export function placeCableLabels(
  cables: Cable[], paths: Map<number, Pt[]>, labels: Map<number, string>, size: number,
  measure: (text: string) => number,
  avoid: Box[] = [],
): Map<number, { p: Pt; angle: number }> {
  const placed: Box[] = [...avoid];
  const out = new Map<number, { p: Pt; angle: number }>();
  const byId = new Map(cables.map(c => [c.id, c]));
  const rootOf = (c: Cable) => {
    let cur = c;
    const seen = new Set([c.id]);
    while (cur.parent !== undefined && byId.has(cur.parent) && !seen.has(cur.parent)) { cur = byId.get(cur.parent)!; seen.add(cur.id); }
    return cur.id;
  };
  for (const c of cables) {
    const text = labels.get(c.id);
    const own = paths.get(c.id) ?? c.points;
    if (!text || own.length < 2) continue;
    // Straight parts to choose from: this cable's, plus (for a chain's first cable) those of the whole chain
    const polys = [own, ...(c.route !== undefined && c.route !== ''
      ? cables.filter(k => k.id !== c.id && rootOf(k) === c.id).map(k => paths.get(k.id) ?? k.points) : [])];
    const parts: { a: Pt; b: Pt; len: number }[] = [];
    for (const poly of polys)
      for (let i = 1; i < poly.length; i++) {
        const len = Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
        if (len > 0.5) parts.push({ a: poly[i - 1], b: poly[i], len });
      }
    parts.sort((x, y) => y.len - x.len);
    const w = measure(text), h = size;
    const off = (c.width ?? 3) / 2 + size / 2 + 2;
    let best: { p: Pt; angle: number; box: Box; score: number } | null = null;
    search: for (const part of parts) {
      const ux = (part.b.x - part.a.x) / part.len, uy = (part.b.y - part.a.y) / part.len;
      const angle = Math.atan2(uy, ux) * 180 / Math.PI;
      const nx = -uy, ny = ux;
      const up = ny > 0 || (ny === 0 && nx > 0) ? -1 : 1;
      const short = Math.max(0, w + 4 - part.len);
      for (const f of FRACTIONS) {
        // keep the text inside the straight part when it fits
        const t = short > 0 ? part.len / 2 : Math.min(part.len - w / 2 - 2, Math.max(w / 2 + 2, part.len * f));
        for (const side of [up, -up]) {
          const p = { x: part.a.x + ux * t + nx * off * side, y: part.a.y + uy * t + ny * off * side };
          const hx = Math.abs(ux) * w / 2 + Math.abs(nx) * h / 2, hy = Math.abs(uy) * w / 2 + Math.abs(ny) * h / 2;
          const box = { x0: p.x - hx, y0: p.y - hy, x1: p.x + hx, y1: p.y + hy };
          const score = placed.reduce((sum, bx) => sum + overlap(box, bx), 0) + short * 1000;
          if (!best || score < best.score) best = { p, angle, box, score };
          if (score === 0) break search;
        }
        if (short > 0) break;
      }
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
