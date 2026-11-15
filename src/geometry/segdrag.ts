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
