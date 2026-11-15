/**
 * "Tidy cables": cables near trays are routed through the tray network; the others get straight runs
 * at right angles, with close parallel runs merged into one shared run (drawn side by side by layoutCables).
 * Cable ends stay put. (pure)
 */
import type { Cable, Tray } from '../types';
import type { Pt } from './hit';
import { projectOnPath, pathLength } from './cable';

export interface TidyOptions {
  /** Parallel runs closer than this (cm) are merged */
  tolerance?: number;
  /** Merged runs are rounded to this grid (cm) */
  grid?: number;
  /** A cable end this close to a tray (cm) is routed through the trays */
  trayReach?: number;
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

// ── Routing through trays ──

interface TSeg { a: Pt; b: Pt; len: number; u: Pt }

const key = (p: Pt) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

function traySegments(trays: Tray[]): TSeg[] {
  const out: TSeg[] = [];
  for (const t of trays)
    for (let i = 1; i < t.points.length; i++) {
      const a = t.points[i - 1], b = t.points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 0.5) out.push({ a, b, len, u: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } });
    }
  return out;
}

/** Nearest point on a segment and its distance */
function onSeg(sg: TSeg, p: Pt): { p: Pt; d: number; t: number } {
  const t = Math.max(0, Math.min(sg.len, (p.x - sg.a.x) * sg.u.x + (p.y - sg.a.y) * sg.u.y));
  const q = { x: sg.a.x + sg.u.x * t, y: sg.a.y + sg.u.y * t };
  return { p: q, d: Math.hypot(q.x - p.x, q.y - p.y), t };
}

/**
 * Path from `s` to `e` through the tray network: a straight lead to the nearest tray, along the trays
 * (they connect where they cross, meet or end next to each other) and a lead to `e`. Null when an end is
 * farther than `reach` from every tray or the trays don't connect.
 */
export function routeViaTrays(s: Pt, e: Pt, trays: Tray[], reach = 300): Pt[] | null {
  const segs = traySegments(trays);
  if (segs.length === 0) return null;
  const join = Math.max(15, ...trays.map(t => t.width)) ;
  // Points on each segment: its ends, junctions with other trays, and the two access points
  const pointsOn: Pt[][] = segs.map(sg => [sg.a, sg.b]);
  segs.forEach((s1, i) => segs.forEach((s2, j) => {
    if (i >= j) return;
    // crossing
    const den = s1.u.x * s2.u.y - s1.u.y * s2.u.x;
    if (Math.abs(den) > 1e-9) {
      const dx = s2.a.x - s1.a.x, dy = s2.a.y - s1.a.y;
      const t1 = (dx * s2.u.y - dy * s2.u.x) / den, t2 = (dx * s1.u.y - dy * s1.u.x) / den;
      if (t1 >= -1e-6 && t1 <= s1.len + 1e-6 && t2 >= -1e-6 && t2 <= s2.len + 1e-6) {
        const q = { x: s1.a.x + s1.u.x * t1, y: s1.a.y + s1.u.y * t1 };
        pointsOn[i].push(q); pointsOn[j].push(q);
      }
    }
  }));
  // ends of a segment close to another segment (a tray ending at the side of another one): bridge them
  const bridges: [Pt, Pt][] = [];
  segs.forEach((s1, i) => [s1.a, s1.b].forEach(end => segs.forEach((s2, j) => {
    if (i === j) return;
    const r = onSeg(s2, end);
    if (r.d > 0.01 && r.d <= join) { pointsOn[j].push(r.p); bridges.push([end, r.p]); }
  })));
  const access = (p: Pt) => {
    let best: { p: Pt; d: number; i: number } | null = null;
    segs.forEach((sg, i) => { const r = onSeg(sg, p); if (!best || r.d < best.d) best = { p: r.p, d: r.d, i }; });
    return best!;
  };
  const as = access(s), ae = access(e);
  if (as.d > reach || ae.d > reach) return null;
  pointsOn[as.i].push(as.p);
  pointsOn[ae.i].push(ae.p);

  // Graph: consecutive points along each segment, plus bridges
  const nodes = new Map<string, Pt>();
  const adj = new Map<string, { to: string; w: number }[]>();
  const link = (a: Pt, b: Pt) => {
    const ka = key(a), kb = key(b);
    nodes.set(ka, a); nodes.set(kb, b);
    if (ka === kb) return;
    const w = Math.hypot(b.x - a.x, b.y - a.y);
    adj.set(ka, [...(adj.get(ka) ?? []), { to: kb, w }]);
    adj.set(kb, [...(adj.get(kb) ?? []), { to: ka, w }]);
  };
  segs.forEach((sg, i) => {
    const pts = [...pointsOn[i]].sort((p, q) => ((p.x - sg.a.x) * sg.u.x + (p.y - sg.a.y) * sg.u.y) - ((q.x - sg.a.x) * sg.u.x + (q.y - sg.a.y) * sg.u.y));
    for (let k = 1; k < pts.length; k++) link(pts[k - 1], pts[k]);
  });
  for (const [a, b] of bridges) link(a, b);

  // Dijkstra
  const start = key(as.p), goal = key(ae.p);
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([start]);
  while (open.size) {
    let cur = '', best = Infinity;
    for (const k of open) if ((dist.get(k) ?? Infinity) < best) { best = dist.get(k)!; cur = k; }
    open.delete(cur);
    if (cur === goal) break;
    for (const { to, w } of adj.get(cur) ?? []) {
      const nd = best + w;
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); prev.set(to, cur); open.add(to); }
    }
  }
  if (!dist.has(goal)) return null;
  const along: Pt[] = [];
  for (let k: string | undefined = goal; k !== undefined; k = prev.get(k)) along.unshift(nodes.get(k)!);

  // Leads: square to the tray (first across it, then along its line to the access point)
  const lead = (p: Pt, acc: { p: Pt; i: number }): Pt[] => {
    const u = segs[acc.i].u;
    const t = (p.x - acc.p.x) * u.x + (p.y - acc.p.y) * u.y;
    const corner = { x: acc.p.x + u.x * t, y: acc.p.y + u.y * t };
    return Math.hypot(corner.x - acc.p.x, corner.y - acc.p.y) > 0.5 ? [corner] : [];
  };
  return simplify([s, ...lead(s, as), ...along, ...lead(e, ae).reverse(), e]);
}

/**
 * New point lists for the cables (keyed by cable id). Cables whose ends are near trays go through the trays;
 * a continuation then branches off its parent at the point nearest to its own end.
 */
export function tidyCables(cables: Cable[], trays: Tray[], opts: TidyOptions = {}): Map<number, Pt[]> {
  const out = new Map<number, Pt[]>();
  const free: Cable[] = [];
  const byId = new Map(cables.map(c => [c.id, c]));
  const done = new Set<number>();
  const visit = (c: Cable) => {
    if (done.has(c.id)) return;
    done.add(c.id);
    const up = c.parent !== undefined ? byId.get(c.parent) : undefined;
    if (up) visit(up);
    const end = c.points[c.points.length - 1];
    let start = c.points[0];
    // A continuation that started on its parent branches off the parent's new path where it is nearest to its end
    if (up && out.has(up.id) && projectOnPath(up.points, start).dist <= 1) {
      // not from the parent's lead into its own socket
      const upPath = out.get(up.id)!;
      start = projectOnPath(upPath.length > 2 ? upPath.slice(0, -1) : upPath, end).p;
    }
    const routed = trays.length && !c.noTray ? routeViaTrays(start, end, trays, opts.trayReach ?? 300) : null;
    if (routed && pathLength(routed) > 0) out.set(c.id, routed);
    else free.push(start === c.points[0] ? c : { ...c, points: [start, ...c.points.slice(1)] });
  };
  cables.forEach(visit);
  // Cables outside the trays are laid out on their own, not put onto trays
  for (const [id, p] of tidyFree(free.filter(c => !c.noTray), trays, opts)) out.set(id, p);
  for (const [id, p] of tidyFree(free.filter(c => c.noTray), [], opts)) out.set(id, p);
  return out;
}

/** Straight runs at right angles; close parallel runs merged (keyed by cable id) */
function tidyFree(cables: Cable[], trays: Tray[], opts: TidyOptions = {}): Map<number, Pt[]> {
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
