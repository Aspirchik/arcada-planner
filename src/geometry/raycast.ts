import type { FurnitureItem } from '../types';
import type { FloorWallGeom } from './walls';
import { rectCorners, type Pt } from './hit';

export interface Segment { a: Pt; b: Pt }

/** Distance along the ray p + t·d (d is a unit vector) to the segment, or null if it misses */
export function raySegment(p: Pt, d: Pt, s: Segment): number | null {
  const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  const qx = s.a.x - p.x, qy = s.a.y - p.y;
  const t = (qx * ey - qy * ex) / den;
  const u = (qx * d.y - qy * d.x) / den;
  if (t < 1e-6 || u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

/** Nearest hit along the ray, or null */
export function castRay(p: Pt, d: Pt, segments: Segment[], maxDist = Infinity): number | null {
  let best: number | null = null;
  for (const s of segments) {
    const t = raySegment(p, d, s);
    if (t !== null && t <= maxDist && (best === null || t < best)) best = t;
  }
  return best;
}

/** Obstacle outlines: wall faces, wall end caps and furniture edges */
export function obstacleSegments(geom: FloorWallGeom, furniture: FurnitureItem[]): Segment[] {
  const out: Segment[] = [];
  for (const w of geom.walls) {
    out.push({ a: w.left.a, b: w.left.b }, { a: w.right.a, b: w.right.b });
    if (w.freeA) out.push({ a: w.left.a, b: w.right.a });
    if (w.freeB) out.push({ a: w.left.b, b: w.right.b });
  }
  for (const f of furniture) {
    const c = rectCorners(f.x, f.y, f.w, f.h, f.rot);
    for (let i = 0; i < 4; i++) out.push({ a: c[i], b: c[(i + 1) % 4] });
  }
  return out;
}

export interface Gap {
  from: Pt;
  to: Pt;
  distance: number;
}

const SAMPLES = 5;
const INSET = 1; // keep sample points off the exact corners

/**
 * Clearance from each of the 4 sides of an item to the nearest obstacle,
 * measured along the item's own axes. Returns up to 4 gaps.
 */
export function itemGaps(item: FurnitureItem, obstacles: Segment[], maxDist = 1000): Gap[] {
  const rad = item.rot * Math.PI / 180;
  const ux = { x: Math.cos(rad), y: Math.sin(rad) };   // local +x
  const uy = { x: -Math.sin(rad), y: Math.cos(rad) };  // local +y
  const at = (lx: number, ly: number): Pt => ({ x: item.x + lx * ux.x + ly * uy.x, y: item.y + lx * ux.y + ly * uy.y });
  const neg = (v: Pt): Pt => ({ x: -v.x, y: -v.y });

  const sides: { dir: Pt; point: (s: number) => Pt }[] = [
    { dir: neg(uy), point: s => at(INSET + s * (item.w - 2 * INSET), 0) },       // top
    { dir: uy,      point: s => at(INSET + s * (item.w - 2 * INSET), item.h) },  // bottom
    { dir: neg(ux), point: s => at(0, INSET + s * (item.h - 2 * INSET)) },       // left
    { dir: ux,      point: s => at(item.w, INSET + s * (item.h - 2 * INSET)) },  // right
  ];

  const gaps: Gap[] = [];
  for (const side of sides) {
    let best: Gap | null = null;
    for (let i = 0; i < SAMPLES; i++) {
      const p = side.point(i / (SAMPLES - 1));
      const t = castRay(p, side.dir, obstacles, maxDist);
      if (t !== null && (best === null || t < best.distance)) {
        best = { from: p, to: { x: p.x + side.dir.x * t, y: p.y + side.dir.y * t }, distance: t };
      }
    }
    if (best) gaps.push(best);
  }
  return gaps;
}
