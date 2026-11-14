/** Cable polyline helpers (pure) */
import type { Cable } from '../types';
import { distToSegment, type Pt } from './hit';
import { formatMeters } from './wallLabels';

export function pathLength(points: Pt[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return l;
}

/** Point halfway along the polyline and the direction of the segment there (degrees) */
export function midAlong(points: Pt[]): { p: Pt; angle: number } {
  const half = pathLength(points) / 2;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= half && seg > 0) {
      const t = (half - acc) / seg;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
    }
    acc += seg;
  }
  return { p: points[0] ?? { x: 0, y: 0 }, angle: 0 };
}

/** Text shown along the cable: its label and/or length */
export function cableLabel(c: Cable, unitM: string): string {
  const parts: string[] = [];
  if (c.label?.trim()) parts.push(c.label.trim());
  if (c.showLength) parts.push(formatMeters(pathLength(c.points), unitM));
  return parts.join(' · ');
}

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
