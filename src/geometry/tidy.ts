/**
 * "Tidy cables": straight runs at right angles, close parallel runs merged into one shared run
 * (drawn side by side by layoutCables), runs near a tray put on its centre line. Cable ends stay put. (pure)
 */
import type { Cable, Tray } from '../types';
import type { Pt } from './hit';

export interface TidyOptions {
  /** Parallel runs closer than this (cm) are merged */
  tolerance?: number;
  /** Merged runs are rounded to this grid (cm) */
  grid?: number;
}

const EPS = 0.5;

/** Removes repeated points and middle points of straight runs */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    out.push({ x: p.x, y: p.y });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
    const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
    if (sameX || sameY) out.splice(i, 1);
  }
  return out;
}

/** Turns every slanted segment into a right-angle bend; nearly straight segments are straightened (ends stay) */
export function orthogonal(points: Pt[], straighten = 3): Pt[] {
  const n = points.length;
  const out: Pt[] = [{ ...points[0] }];
  for (let i = 1; i < n; i++) {
    const a = out[out.length - 1];
    const b = { ...points[i] };
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) < EPS || Math.abs(dy) < EPS) { out.push(b); continue; }
    const fixed = i === n - 1;
    // Nearly straight: move the (free) point onto the line instead of adding a tiny bend
    if (!fixed && Math.min(Math.abs(dx), Math.abs(dy)) <= straighten) {
      if (Math.abs(dx) < Math.abs(dy)) b.x = a.x; else b.y = a.y;
      out.push(b);
      continue;
    }
    out.push(Math.abs(dx) >= Math.abs(dy) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, b);
  }
  return out;
}

/**
 * Replaces staircases (four right-angle segments going the same way, e.g. down-left-down-left)
 * with a single bend. Ends stay put. Input must be orthogonal and simplified.
 */
export function unstair(points: Pt[]): Pt[] {
  let p = points.map(q => ({ ...q }));
  const dir = (a: Pt, b: Pt) => (Math.abs(a.y - b.y) < EPS ? { h: true, s: Math.sign(b.x - a.x) } : { h: false, s: Math.sign(b.y - a.y) });
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i + 4 < p.length; i++) {
      const d = [0, 1, 2, 3].map(k => dir(p[i + k], p[i + k + 1]));
      if (d[0].h === d[1].h || d[0].h !== d[2].h || d[1].h !== d[3].h) continue;
      if (d[0].s !== d[2].s || d[1].s !== d[3].s) continue;
      const a = p[i], b = p[i + 4];
      const corner = d[0].h ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
      p = [...p.slice(0, i + 1), corner, ...p.slice(i + 4)];
      changed = true;
      break;
    }
  }
  return simplify(p);
}

interface Run { cable: number; i: number; horiz: boolean; c: number; lo: number; hi: number }

/** New point lists for the cables (keyed by cable id) */
export function tidyCables(cables: Cable[], trays: Tray[], opts: TidyOptions = {}): Map<number, Pt[]> {
  const tol = opts.tolerance ?? 20;
  const grid = opts.grid ?? 5;
  // Long end segments get a short fixed stub at the cable end, so the rest of them can slide into a shared run
  const withStubs = (p: Pt[]): Pt[] => {
    const out = p.map(q => ({ ...q }));
    const stub = (from: Pt, to: Pt): Pt => {
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      return { x: from.x + (to.x - from.x) * tol / len, y: from.y + (to.y - from.y) * tol / len };
    };
    const n = out.length;
    if (n >= 2 && Math.hypot(out[n - 1].x - out[n - 2].x, out[n - 1].y - out[n - 2].y) > tol * 2) {
      const e = stub(out[n - 1], out[n - 2]);
      out.splice(n - 1, 0, { ...e }, { ...e });
    }
    if (Math.hypot(out[1].x - out[0].x, out[1].y - out[0].y) > tol * 2) {
      const s = stub(out[0], out[1]);
      out.splice(1, 0, { ...s }, { ...s });
    }
    return out;
  };
  const paths = cables.map(c => withStubs(unstair(simplify(orthogonal(simplify(c.points))))));

  // Inner runs (both ends free) can slide sideways; runs touching a cable end can't
  const runs: Run[] = [];
  paths.forEach((p, ci) => {
    for (let i = 1; i + 2 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      if (Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS) continue;
      const horiz = Math.abs(a.y - b.y) < EPS;
      runs.push({ cable: ci, i, horiz, c: horiz ? a.y : a.x, lo: Math.min(horiz ? a.x : a.y, horiz ? b.x : b.y), hi: Math.max(horiz ? a.x : a.y, horiz ? b.x : b.y) });
    }
  });

  // Straight tray parts the runs can be put on
  const trayRuns: { horiz: boolean; c: number; lo: number; hi: number }[] = [];
  for (const t of trays)
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1], b = t.points[i];
      if (Math.abs(a.y - b.y) < EPS) trayRuns.push({ horiz: true, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      else if (Math.abs(a.x - b.x) < EPS) trayRuns.push({ horiz: false, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }

  // Group parallel runs that are close and overlap along their length
  const overlaps = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) => a.lo <= b.hi + tol && b.lo <= a.hi + tol;
  const done = new Set<Run>();
  const sorted = [...runs].sort((a, b) => a.c - b.c);
  for (const r of sorted) {
    if (done.has(r)) continue;
    const group = [r];
    done.add(r);
    for (let grew = true; grew;) {
      grew = false;
      for (const s of sorted) {
        if (done.has(s) || s.horiz !== r.horiz) continue;
        if (group.some(g => Math.abs(g.c - s.c) <= tol && overlaps(g, s))) { group.push(s); done.add(s); grew = true; }
      }
    }
    const mean = group.reduce((sum, g) => sum + g.c, 0) / group.length;
    const lo = Math.min(...group.map(g => g.lo)), hi = Math.max(...group.map(g => g.hi));
    const tray = trayRuns
      .filter(t => t.horiz === r.horiz && Math.abs(t.c - mean) <= tol * 1.5 && overlaps(t, { lo, hi }))
      .sort((a, b) => Math.abs(a.c - mean) - Math.abs(b.c - mean))[0];
    const value = tray ? tray.c : Math.round(mean / grid) * grid;
    for (const g of group) {
      const p = paths[g.cable];
      if (g.horiz) { p[g.i].y = value; p[g.i + 1].y = value; } else { p[g.i].x = value; p[g.i + 1].x = value; }
    }
  }

  return new Map(cables.map((c, i) => [c.id, simplify(paths[i])]));
}
