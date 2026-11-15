/**
 * Cable heights above the floor: every cable point gets a height, so the length counts the vertical runs
 * (e.g. down from the ceiling to a control panel). (pure)
 *
 * Height of a point, first that is known:
 *  1. its own height (`point.z`),
 *  2. the end connected to an item: the item's mounting height (`elev`),
 *  3. the start of a continuation: the parent's height there,
 *  4. a point lying in a tray with a height (cables marked "not in tray" skip this),
 *  5. the cable's run height (`height`).
 * Points still unknown take the height of the previous point (or the next one), so they add no vertical run.
 */
import type { Cable, FurnitureItem, Tray } from '../types';
import { rectCorners, type Pt } from './hit';
import { pathLength, distToPath } from './cable';

export interface HeightCtx {
  /** Mounting height of a furniture item (cm), if set */
  elevOf: (id: number) => number | undefined;
  /** All trays of the floor */
  trays: Tray[];
}

/** Height of the tray the point lies in (only trays with a height) */
export function trayHeightAt(trays: Tray[], p: Pt): number | undefined {
  for (const t of trays)
    if (t.elev !== undefined && distToPath(t.points, p) <= t.width / 2 + 1) return t.elev;
  return undefined;
}

/**
 * Mounting height of an item: its own `elev`, or — for an item standing in a tray with a height
 * (e.g. a socket in a trunking at 40 cm) — the tray's height. `inTray` tells which one it is.
 */
export function itemElevation(it: FurnitureItem, trays: Tray[]): { z: number; inTray: boolean } | undefined {
  if (it.elev !== undefined) return { z: it.elev, inTray: false };
  const c = rectCorners(it.x, it.y, it.w, it.h, it.rot);
  const mid = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
  for (const t of trays)
    if (t.elev !== undefined && distToPath(t.points, mid) <= t.width / 2 + 5) return { z: t.elev, inTray: true };
  return undefined;
}

/** Height at point `p` lying on a polyline whose point heights are `zs` (the nearer end of the nearest segment) */
function heightOnPath(points: Pt[], zs: number[], p: Pt): number {
  let best = 0, bestD = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < bestD) { bestD = d; best = t < 0.5 ? zs[i - 1] : zs[i]; }
  }
  return best;
}

/** Height of each point before filling the gaps (undefined = not known) */
function rawHeights(c: Cable, ctx: HeightCtx, parentZ?: number): (number | undefined)[] {
  const last = c.points.length - 1;
  return c.points.map((p, i) => {
    if (p.z !== undefined) return p.z;
    if (i === 0 && c.fromLink) { const e = ctx.elevOf(c.fromLink.id); if (e !== undefined) return e; }
    if (i === last && c.toLink) { const e = ctx.elevOf(c.toLink.id); if (e !== undefined) return e; }
    if (i === 0 && parentZ !== undefined) return parentZ;
    if (!c.noTray) { const z = trayHeightAt(ctx.trays, p); if (z !== undefined) return z; }
    return c.height;
  });
}

/** Unknown heights take the previous known one (or the next one at the start); null when none is known */
function fill(raw: (number | undefined)[]): number[] | null {
  const first = raw.find(z => z !== undefined);
  if (first === undefined) return null;
  let cur = first;
  return raw.map(z => (cur = z ?? cur));
}

/** Point heights of every cable (keyed by id; null = no heights known, the cable is flat) */
export function cableHeights(cables: Cable[], ctx: HeightCtx): Map<number, number[] | null> {
  const byId = new Map(cables.map(c => [c.id, c]));
  const out = new Map<number, number[] | null>();
  const busy = new Set<number>();
  const visit = (c: Cable): number[] | null => {
    if (out.has(c.id)) return out.get(c.id)!;
    if (busy.has(c.id)) return null;
    busy.add(c.id);
    const up = c.parent !== undefined ? byId.get(c.parent) : undefined;
    const upZ = up ? visit(up) : null;
    const parentZ = up && upZ && c.points.length ? heightOnPath(up.points, upZ, c.points[0]) : undefined;
    const zs = fill(rawHeights(c, ctx, parentZ));
    out.set(c.id, zs);
    return zs;
  };
  cables.forEach(visit);
  return out;
}

/**
 * Heights for a re-laid cable: the new points take the own height of the old point they replace
 * (the nearest old point with a height within `near` cm); the ends keep theirs.
 */
type CablePt = { x: number; y: number; z?: number; joint?: boolean };

export function carryHeights(old: CablePt[], next: Pt[], near = 30): CablePt[] {
  return carryJoints(old, carryZ(old, next, near));
}

/** Connectors of the old points go to the same spot on the new path (onto a point there, or a new point) */
function carryJoints(old: CablePt[], next: CablePt[]): CablePt[] {
  const out = next.map(p => ({ ...p }));
  for (const j of old.filter(p => p.joint)) {
    let best = { i: 1, d: Infinity, q: out[0] as Pt };
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], b = out[i];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((j.x - a.x) * dx + (j.y - a.y) * dy) / l2));
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(q.x - j.x, q.y - j.y);
      if (d < best.d) best = { i, d, q };
    }
    const at = out.findIndex(p => Math.hypot(p.x - best.q.x, p.y - best.q.y) <= 1);
    if (at >= 0) out[at].joint = true;
    else out.splice(best.i, 0, { x: Math.round(best.q.x * 10) / 10, y: Math.round(best.q.y * 10) / 10, joint: true });
  }
  return out;
}

function carryZ(old: CablePt[], next: Pt[], near: number): CablePt[] {
  const withZ = old.filter(p => p.z !== undefined);
  if (withZ.length === 0) return next.map(p => ({ x: p.x, y: p.y }));
  const last = next.length - 1;
  return next.map((p, i) => {
    const own = i === 0 ? old[0] : i === last ? old[old.length - 1] : undefined;
    if (own && own.z !== undefined) return { x: p.x, y: p.y, z: own.z };
    if (own) return { x: p.x, y: p.y };
    let best: { z?: number } | undefined, bestD = near;
    for (const q of withZ) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d <= bestD) { bestD = d; best = q; } }
    return best ? { x: p.x, y: p.y, z: best.z } : { x: p.x, y: p.y };
  });
}

/** Total vertical run of a cable with these point heights, cm */
export function verticalRun(zs: number[] | null | undefined): number {
  if (!zs) return 0;
  let v = 0;
  for (let i = 1; i < zs.length; i++) v += Math.abs(zs[i] - zs[i - 1]);
  return v;
}

/** Length of a cable counting the vertical runs: along the plan + up / down */
export function length3d(points: Pt[], zs: number[] | null | undefined): number {
  return pathLength(points) + verticalRun(zs);
}
