/**
 * Desk frames (pure): patch cords on a desk are fixed to the metal frame under the desktop, not laid straight.
 * The frame is the desk rectangle shrunk by an inset; a cord goes from its device to the frame, along the frame
 * to the corner nearest to where it leaves, and from that corner to the socket.
 */
import type { FurnitureItem } from '../types';
import { rectCorners, type Pt } from './hit';

/** Frame inset of a desk without its own setting, cm */
export const DEFAULT_FRAME_INSET = 5;

const DESKS = new Set(['Desk', 'Corner desk', 'Table']);

/** Frame inset of an item (cm), or undefined when it has no frame (not a desk) */
export function frameInset(it: FurnitureItem): number | undefined {
  if (it.frame !== undefined) return it.frame;
  return it.name && DESKS.has(it.name) ? DEFAULT_FRAME_INSET : undefined;
}

/** Corners of the frame (the desk rectangle shrunk by the inset), in plan coordinates, going around */
export function frameCorners(it: FurnitureItem, inset: number): Pt[] {
  const i = Math.max(0, Math.min(inset, it.w / 2 - 1, it.h / 2 - 1));
  const rad = it.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const at = (u: number, v: number) => ({ x: it.x + u * cos - v * sin, y: it.y + u * sin + v * cos });
  return [at(i, i), at(it.w - i, i), at(it.w - i, it.h - i), at(i, it.h - i)];
}

/** Frames of all desks of a floor */
export function deskFrames(furniture: FurnitureItem[]): { id: number; corners: Pt[]; outline: Pt[] }[] {
  return furniture.flatMap(it => {
    const inset = frameInset(it);
    return inset === undefined ? [] : [{ id: it.id, corners: frameCorners(it, inset), outline: rectCorners(it.x, it.y, it.w, it.h, it.rot) }];
  });
}

function inside(poly: Pt[], p: Pt): boolean {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inn = !inn;
  }
  return inn;
}

/** Nearest point on the closed frame and the position along it (perimeter distance from corner 0) */
function onFrame(c: Pt[], p: Pt): { p: Pt; s: number } {
  let best = { p: c[0], s: 0, d: Infinity }, acc = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.d) best = { p: q, s: acc + len * t, d };
    acc += len;
  }
  return { p: best.p, s: best.s };
}

/** Points along the frame from position s1 to s2, the shorter way round (corners included) */
function alongFrame(c: Pt[], s1: number, s2: number): Pt[] {
  const lens = c.map((a, i) => Math.hypot(c[(i + 1) % 4].x - a.x, c[(i + 1) % 4].y - a.y));
  const total = lens.reduce((x, y) => x + y, 0);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((x, y) => x + y, 0));
  const fwd = ((s2 - s1) % total + total) % total;
  const dir = fwd <= total - fwd ? 1 : -1;
  const out: Pt[] = [];
  // corners met on the way
  const dist = dir === 1 ? fwd : total - fwd;
  const cs = starts.map((s, i) => ({ i, d: dir === 1 ? ((s - s1) % total + total) % total : ((s1 - s) % total + total) % total }))
    .filter(x => x.d > 0.01 && x.d < dist - 0.01).sort((a, b) => a.d - b.d);
  for (const x of cs) out.push(c[x.i]);
  return out;
}

const round = (p: Pt) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

/**
 * Route of a patch cord with an end on a desk: from that end to the frame, along the frame to the frame corner
 * nearest to the other end, then to the other end (right angles). Both ends on one desk: along the frame between
 * them. Null when no end lies on a desk.
 */
export function routeViaDesk(a: Pt, b: Pt, frames: { corners: Pt[]; outline: Pt[] }[]): Pt[] | null {
  const fa = frames.find(f => inside(f.outline, a)), fb = frames.find(f => inside(f.outline, b));
  const f = fa ?? fb;
  if (!f) return null;
  const flip = !fa;
  const [s, e] = flip ? [b, a] : [a, b];
  const c = f.corners;
  const p1 = onFrame(c, s);
  let path: Pt[];
  if (fa && fb && fa === fb) {
    const p2 = onFrame(c, e);
    path = [s, p1.p, ...alongFrame(c, p1.s, p2.s), p2.p, e];
  } else {
    // the corner nearest to where the cord goes
    let ci = 0;
    for (let i = 1; i < 4; i++) if (Math.hypot(c[i].x - e.x, c[i].y - e.y) < Math.hypot(c[ci].x - e.x, c[ci].y - e.y)) ci = i;
    const corner = onFrame(c, c[ci]);
    const out = Math.abs(e.x - c[ci].x) >= Math.abs(e.y - c[ci].y) ? { x: c[ci].x, y: e.y } : { x: e.x, y: c[ci].y };
    path = [s, p1.p, ...alongFrame(c, p1.s, corner.s), c[ci], out, e];
  }
  // drop repeated points
  const clean: Pt[] = [];
  for (const p of path.map(round)) if (!clean.length || Math.hypot(p.x - clean[clean.length - 1].x, p.y - clean[clean.length - 1].y) > 0.5) clean.push(p);
  return flip ? clean.reverse() : clean;
}
