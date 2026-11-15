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

/** Shorter distance along the closed frame between positions s1 and s2 */
function frameDist(c: Pt[], s1: number, s2: number): number {
  const total = c.reduce((t, a, i) => t + Math.hypot(c[(i + 1) % 4].x - a.x, c[(i + 1) % 4].y - a.y), 0);
  const d = ((s2 - s1) % total + total) % total;
  return Math.min(d, total - d);
}

/** Where a cord from `p` meets the frame: the nearest side (on a tie, the one closer to frame position `goal`) */
function entry(c: Pt[], p: Pt, goal: number): { p: Pt; s: number } {
  let best: { p: Pt; s: number; cost: number } | null = null, acc = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    // the nearest side of the frame (straight down from the device); on a tie the one closer to the goal
    const cost = Math.hypot(q.x - p.x, q.y - p.y) * 1000 + frameDist(c, acc + len * t, goal);
    if (!best || cost < best.cost - 0.01) best = { p: q, s: acc + len * t, cost };
    acc += len;
  }
  return best!;
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

/** L-shaped link from `a` to `b`: along the longer direction first */
function ell(a: Pt, b: Pt): Pt[] {
  if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) return [];
  return [Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }];
}

/** The start of the cord, if it lies on a desk, re-laid along that desk's frame; the rest of the drawn path is kept */
function fixStart(pts: Pt[], frames: { corners: Pt[]; outline: Pt[] }[]): Pt[] | null {
  const f = frames.find(fr => inside(fr.outline, pts[0]));
  if (!f) return null;
  const c = f.corners;
  const s = pts[0];
  const k = pts.findIndex((p, i) => i > 0 && !inside(f.outline, p));
  if (k < 0) {
    // both ends on this desk: along the frame between them
    const e = pts[pts.length - 1], p2 = onFrame(c, e), p1 = entry(c, s, p2.s);
    return [s, p1.p, ...alongFrame(c, p1.s, p2.s), p2.p, e];
  }
  // leaves the desk towards the first drawn point outside it: at the frame corner nearest to that point
  const q = pts[k];
  let ci = 0;
  for (let i = 1; i < 4; i++) if (Math.hypot(c[i].x - q.x, c[i].y - q.y) < Math.hypot(c[ci].x - q.x, c[ci].y - q.y)) ci = i;
  const corner = onFrame(c, c[ci]);
  const p1 = entry(c, s, corner.s);
  return [s, p1.p, ...alongFrame(c, p1.s, corner.s), c[ci], ...ell(c[ci], q), ...pts.slice(k)];
}

/**
 * A patch cord with an end on a desk: from that end to the desk frame, along the frame to the frame corner nearest
 * to where the drawn cord leaves the desk, and on along the drawn path. Both ends on desks — both are fixed.
 * Null when no end lies on a desk.
 */
export function routeViaDesk(points: Pt[], frames: { corners: Pt[]; outline: Pt[] }[]): Pt[] | null {
  if (points.length < 2) return null;
  let pts = points;
  let changed = false;
  const a = fixStart(pts, frames);
  if (a) { pts = a; changed = true; }
  const b = fixStart([...pts].reverse(), frames);
  if (b && !(a && frames.find(fr => inside(fr.outline, points[0])) === frames.find(fr => inside(fr.outline, points[points.length - 1])))) {
    pts = b.reverse();
    changed = true;
  }
  if (!changed) return null;
  const clean: Pt[] = [];
  for (const p of pts.map(round)) if (!clean.length || Math.hypot(p.x - clean[clean.length - 1].x, p.y - clean[clean.length - 1].y) > 0.5) clean.push(p);
  return clean;
}

// ── Neat layout: one exit corner per desk ──

export interface Frame { corners: Pt[]; outline: Pt[] }

/** Index of the desk the point lies on, or -1 */
export function deskAt(frames: Frame[], p: Pt): number {
  return frames.findIndex(f => inside(f.outline, p));
}

/** Index of the first point (after the start) that lies off the desk, or -1 */
export function firstOff(pts: Pt[], f: Frame): number {
  return pts.findIndex((p, i) => i > 0 && !inside(f.outline, p));
}

/** From a point on the desk to the frame and along it to frame corner `ci`: [p, on frame, …corners, corner] */
export function deskHead(f: Frame, p: Pt, ci: number): Pt[] {
  const c = f.corners;
  const goal = onFrame(c, c[ci]);
  const e = entry(c, p, goal.s);
  const out = [p, e.p, ...alongFrame(c, e.s, goal.s), c[ci]].map(round);
  const clean: Pt[] = [];
  for (const q of out) if (!clean.length || Math.hypot(q.x - clean[clean.length - 1].x, q.y - clean[clean.length - 1].y) > 0.5) clean.push(q);
  return clean;
}

/** How far along the drawn path past the desk tells where a cord is heading, cm */
const AHEAD = 100;

function pointAlongPath(pts: Pt[], dist: number): Pt {
  let left = dist;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= left && l > 0) return { x: a.x + (b.x - a.x) * left / l, y: a.y + (b.y - a.y) * left / l };
    left -= l;
  }
  return pts[pts.length - 1];
}

/**
 * The exit corner of every desk with patch cords: the frame corner nearest to where its cords are heading
 * (their drawn paths about a metre past the desk, on average), so all cords of a desk leave together.
 */
export function exitCorners(cords: Pt[][], frames: Frame[]): Map<number, number> {
  const spots = new Map<number, Pt[]>();
  for (const pts of cords) {
    for (const path of [pts, [...pts].reverse()]) {
      const d = deskAt(frames, path[0]);
      if (d < 0) continue;
      const k = firstOff(path, frames[d]);
      if (k < 0) continue;
      // where the cord is heading: its drawn path about a metre past the desk
      spots.set(d, [...(spots.get(d) ?? []), pointAlongPath(path.slice(k), AHEAD)]);
    }
  }
  const out = new Map<number, number>();
  for (const [d, list] of spots) {
    const m = { x: list.reduce((t, p) => t + p.x, 0) / list.length, y: list.reduce((t, p) => t + p.y, 0) / list.length };
    const c = frames[d].corners;
    let ci = 0;
    for (let i = 1; i < 4; i++) if (Math.hypot(c[i].x - m.x, c[i].y - m.y) < Math.hypot(c[ci].x - m.x, c[ci].y - m.y)) ci = i;
    out.set(d, ci);
  }
  return out;
}

/**
 * Joins the drawn path (off the desk) to a desk corner without going back: the drawn line nearest to the corner
 * (the first one may be extended backwards) is met straight from the corner, and the path goes on from there.
 */
export function joinAtCorner(corner: Pt, drawn: Pt[]): Pt[] {
  if (drawn.length < 2) return drawn;
  let best = { d: Infinity, p: drawn[0], j: 0 };
  for (let j = 0; j + 1 < drawn.length; j++) {
    const a = drawn[j], b = drawn[j + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (l2 < 1e-6) continue;
    let t = ((corner.x - a.x) * dx + (corner.y - a.y) * dy) / l2;
    t = Math.min(1, j === 0 ? t : Math.max(0, t));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(q.x - corner.x, q.y - corner.y);
    if (d < best.d - 0.01) best = { d, p: round(q), j };
  }
  return [best.p, ...drawn.slice(best.j + 1)];
}
