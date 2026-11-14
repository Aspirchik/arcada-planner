import type { FloorState } from '../types';
import type { FloorWallGeom } from './walls';
import type { Segment } from './raycast';
import { rectCorners, type Pt } from './hit';
import { isPort, itemAt } from './links';
import type { FurnitureItem } from '../types';

export interface SnapTargets {
  /** Points to snap to first: wall corners, nodes, furniture corners, dimension ends */
  points: Pt[];
  /** Lines to snap onto if no point is near: wall faces and furniture edges */
  segments: Segment[];
  /** Small items (sockets, switches, entry points): anywhere over one snaps to its centre */
  ports: FurnitureItem[];
}

export function snapTargets(floor: FloorState, geom: FloorWallGeom, excludeDimId?: number, excludeCableId?: number): SnapTargets {
  const points: Pt[] = [];
  const segments: Segment[] = [];
  for (const n of floor.nodes) points.push({ x: n.x, y: n.y });
  for (const w of geom.walls) {
    points.push(w.left.a, w.left.b, w.right.a, w.right.b);
    segments.push({ a: w.left.a, b: w.left.b }, { a: w.right.a, b: w.right.b });
  }
  for (const f of floor.furniture) {
    const c = rectCorners(f.x, f.y, f.w, f.h, f.rot);
    points.push(...c);
    // Centre — cables end in the middle of sockets, entry points, switches
    points.push({ x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 });
    for (let i = 0; i < 4; i++) segments.push({ a: c[i], b: c[(i + 1) % 4] });
  }
  for (const c of floor.cables) {
    if (c.id === excludeCableId) continue;
    points.push(...c.points);
  }
  for (const t of floor.trays) {
    points.push(...t.points);
    for (let i = 1; i < t.points.length; i++) segments.push({ a: t.points[i - 1], b: t.points[i] });
  }
  for (const d of floor.dimensions) {
    if (d.id === excludeDimId) continue;
    points.push({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 });
  }
  return { points, segments, ports: floor.furniture.filter(isPort) };
}

function closestOnSegment(p: Pt, s: Segment): Pt {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return s.a;
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return { x: s.a.x + t * dx, y: s.a.y + t * dy };
}

/** Snaps to the nearest target point within `radius`, else onto the nearest line, else returns null */
export function snapToTargets(p: Pt, targets: SnapTargets, radius: number): Pt | null {
  const port = targets.ports?.length ? itemAt(targets.ports, p, radius * 0.6) : null;
  if (port) {
    const c = rectCorners(port.x, port.y, port.w, port.h, port.rot);
    return { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
  }
  let best: Pt | null = null;
  let bestD = radius;
  for (const q of targets.points) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  if (best) return { ...best };
  bestD = radius * 0.7;
  for (const s of targets.segments) {
    const q = closestOnSegment(p, s);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** Keeps the direction from `a` to `p` at a multiple of 45° (Shift while measuring) */
export function constrain45(a: Pt, p: Pt): Pt {
  const dx = p.x - a.x, dy = p.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  // Project onto the constrained direction so the length follows the cursor
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const l = dx * ux + dy * uy;
  return { x: a.x + ux * l, y: a.y + uy * l };
}
