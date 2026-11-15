/**
 * Dragging one straight part of a cable sideways (pure): both its points move across the part, the ends of
 * the cable stay where they are (a new corner is added next to an end), and the part snaps ("magnet") onto
 * parallel parts of other cables and trays nearby, so cables can be led along one path.
 */
import type { Pt } from './hit';

type CPt = { x: number; y: number; z?: number; joint?: boolean };

/** Points prepared for dragging part `seg`: an end point of the cable gets a copy, so the end itself stays */
export function startSegmentDrag(points: CPt[], seg: number): { points: CPt[]; seg: number } {
  let pts = points.map(p => ({ ...p }));
  let s = seg;
  // the copy that moves is a plain corner (no connector)
  if (s === 0) { pts = [pts[0], { ...pts[0], joint: undefined }, ...pts.slice(1)].map(clean); s = 1; }
  if (s + 1 === pts.length - 1) pts = [...pts.slice(0, -1), { ...pts[pts.length - 1], joint: undefined }, pts[pts.length - 1]].map(clean);
  return { points: pts, seg: s };
}

const clean = (p: CPt): CPt => {
  const q: CPt = { x: p.x, y: p.y };
  if (p.z !== undefined) q.z = p.z;
  if (p.joint) q.joint = true;
  return q;
};

/**
 * Part `seg` of `base` moved across itself by the pointer offset `delta`; it snaps onto a parallel line of
 * `targets` within `snap` (plan units), else to `grid` when the part runs along an axis.
 */
export function dragSegment(base: CPt[], seg: number, delta: Pt, targets: Pt[][], snap: number, grid = 0): CPt[] {
  const a = base[seg], b = base[seg + 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return base;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const raw = delta.x * n.x + delta.y * n.y;
  let off = raw;
  // magnet: parallel parts of other cables / trays that overlap this one along its length
  let best = snap;
  let snapped = false;
  for (const line of targets) {
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1], q = line[i];
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      if (l < 1e-6) continue;
      if (Math.abs(((q.x - p.x) * n.x + (q.y - p.y) * n.y) / l) > 0.02) continue; // not parallel
      const t1 = (p.x - a.x) * u.x + (p.y - a.y) * u.y, t2 = (q.x - a.x) * u.x + (q.y - a.y) * u.y;
      if (Math.max(t1, t2) < -snap || Math.min(t1, t2) > len + snap) continue; // no overlap
      const o = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
      if (Math.abs(o - raw) < best) { best = Math.abs(o - raw); off = o; snapped = true; }
    }
  }
  if (!snapped && grid > 0) {
    if (Math.abs(n.x) > 0.999) off = (Math.round((a.x + off * n.x) / grid) * grid - a.x) / n.x;
    else if (Math.abs(n.y) > 0.999) off = (Math.round((a.y + off * n.y) / grid) * grid - a.y) / n.y;
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return base.map((p, i) => (i === seg || i === seg + 1 ? { ...p, x: r(p.x + n.x * off), y: r(p.y + n.y * off) } : p));
}

/** After a drag: repeated points and straight-through points (without own height or connector) removed */
export function tidyAfterDrag(points: CPt[]): CPt[] {
  const out: CPt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.5) {
      if (p.joint) last.joint = true;
      if (p.z !== undefined && last.z === undefined) last.z = p.z;
      continue;
    }
    out.push({ ...p });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if (b.joint || b.z !== undefined) continue;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.5 && dot >= 0) out.splice(i, 1);
  }
  return out.length >= 2 ? out : points;
}

/**
 * Extra points removed: repeated points, points on a straight line and the tips of back-and-forth spikes
 * (a point where the cable turns straight back). Points with an own height or a connector stay.
 */
export function simplifyPath(points: CPt[]): CPt[] {
  let cur = tidyAfterDrag(points);
  for (let changed = true; changed && cur.length > 2;) {
    changed = false;
    for (let i = 1; i < cur.length - 1; i++) {
      const a = cur[i - 1], b = cur[i], c = cur[i + 1];
      if (b.joint || b.z !== undefined) continue;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      if (l1 < 0.5 || l2 < 0.5 || Math.abs(cross) / (l1 * l2) < 0.01) {
        cur = tidyAfterDrag([...cur.slice(0, i), ...cur.slice(i + 1)]);
        changed = true;
        break;
      }
    }
  }
  return cur;
}

/**
 * Straight parts of a cable that run along a part of `guide` (parallel, overlapping, at most `reach` away)
 * are moved onto the guide line; the cable ends stay (a corner is added next to an end). Null when nothing moved.
 */
export function pullOnto(points: CPt[], guide: Pt[], reach: number): CPt[] | null {
  let pts = points;
  let changed = false;
  for (let iter = 0; iter < 60; iter++) {
    let move: { s: number; o: number } | null = null;
    for (let s = 0; s < pts.length - 1 && !move; s++) {
      const a = pts[s], b = pts[s + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, n = { x: -u.y, y: u.x };
      let best: number | null = null;
      let onLine = false;
      for (let i = 1; i < guide.length; i++) {
        const p = guide[i - 1], q = guide[i];
        const l = Math.hypot(q.x - p.x, q.y - p.y);
        if (l < 1e-6 || Math.abs(((q.x - p.x) * n.x + (q.y - p.y) * n.y) / l) > 0.02) continue; // not parallel
        const t1 = (p.x - a.x) * u.x + (p.y - a.y) * u.y, t2 = (q.x - a.x) * u.x + (q.y - a.y) * u.y;
        if (Math.min(len, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) < Math.min(10, len / 2)) continue; // no overlap
        const o = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
        if (Math.abs(o) < 0.5) { onLine = true; break; }
        if (Math.abs(o) <= reach && (best === null || Math.abs(o) < Math.abs(best))) best = o;
      }
      if (!onLine && best !== null) move = { s, o: best };
    }
    if (!move) break;
    const prep = startSegmentDrag(pts, move.s);
    const a = prep.points[prep.seg], b = prep.points[prep.seg + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    pts = tidyAfterDrag(dragSegment(prep.points, prep.seg, { x: n.x * move.o, y: n.y * move.o }, [], 0, 0));
    changed = true;
  }
  return changed ? pts : null;
}

/** Shortest distance between segments ab and cd */
function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const ptSeg = (p: Pt, s: Pt, e: Pt) => {
    const dx = e.x - s.x, dy = e.y - s.y, l2 = dx * dx + dy * dy;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l2));
    return Math.hypot(p.x - s.x - dx * t, p.y - s.y - dy * t);
  };
  const cr = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  if (Math.sign(cr(a, b, c)) !== Math.sign(cr(a, b, d)) && Math.sign(cr(c, d, a)) !== Math.sign(cr(c, d, b))) return 0;
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
}

/** True when some part of the cable comes within `reach` of the guide line */
export function nearGuide(points: Pt[], guide: Pt[], reach: number): boolean {
  for (let i = 1; i < points.length; i++)
    for (let j = 1; j < guide.length; j++)
      if (segDist(points[i - 1], points[i], guide[j - 1], guide[j]) <= reach) return true;
  return false;
}
