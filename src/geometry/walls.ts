/**
 * Wall geometry: the two faces of every wall, with proper corners at joints,
 * and which side of each wall faces a room (enclosed area).
 *
 * Conventions: for a wall from node A to node B with unit direction d,
 * the "left" side is the normal n = (-d.y, d.x) and the "right" side is -n.
 */
import type { WallNode, Wall } from '../types';
import { WALL_THICKNESS, INTERIOR_WALL_THICKNESS } from '../constants';
import type { Pt } from './hit';

export function wallThickness(w: Wall): number {
  return w.thickness && w.thickness > 0 ? w.thickness : (w.exterior ? WALL_THICKNESS : INTERIOR_WALL_THICKNESS);
}

export interface WallFace {
  a: Pt;
  b: Pt;
  /** Length measured along the wall direction (what a tape measure along this face shows) */
  length: number;
  /** True when this side of the wall faces an enclosed room */
  room: boolean;
}

export interface WallGeom {
  wall: Wall;
  a: WallNode;
  b: WallNode;
  /** Unit direction A → B */
  dir: Pt;
  /** Left normal (-dir.y, dir.x) */
  normal: Pt;
  /** Centerline length */
  length: number;
  thickness: number;
  left: WallFace;
  right: WallFace;
  /** Outline polygon: left face A→B, then right face B→A */
  polygon: Pt[];
  /** Ends of the wall that have no other wall attached (square ends) */
  freeA: boolean;
  freeB: boolean;
}

export interface FloorWallGeom {
  walls: WallGeom[];
  /** Filler polygons at nodes where 3+ walls meet (covers the gap between mitred ends) */
  hubs: { polygon: Pt[]; exterior: boolean }[];
}

const EPS = 1e-9;
const MITER_LIMIT = 4; // max corner distance from node, in half-thicknesses

function cross(a: Pt, b: Pt) { return a.x * b.y - a.y * b.x; }

/** Intersection of lines p + s·d and q + r·e; null if (almost) parallel */
function intersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < EPS) return null;
  const s = cross({ x: q.x - p.x, y: q.y - p.y }, e) / den;
  return { x: p.x + s * d.x, y: p.y + s * d.y };
}

interface Spoke {
  wallIdx: number;
  /** Outgoing unit direction from the node along the wall */
  d: Pt;
  angle: number;
  half: number;
}

export function computeWallGeometry(nodes: WallNode[], walls: Wall[]): FloorWallGeom {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const valid: { wall: Wall; a: WallNode; b: WallNode; dir: Pt; length: number; half: number }[] = [];
  for (const w of walls) {
    const a = nodeById.get(w.a), b = nodeById.get(w.b);
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-6) continue;
    valid.push({ wall: w, a, b, dir: { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, length, half: wallThickness(w) / 2 });
  }

  // Spokes around every node, sorted by angle
  const spokes = new Map<number, Spoke[]>();
  valid.forEach((v, i) => {
    const add = (nid: number, d: Pt) => {
      const list = spokes.get(nid) ?? [];
      list.push({ wallIdx: i, d, angle: Math.atan2(d.y, d.x), half: v.half });
      spokes.set(nid, list);
    };
    add(v.a.id, v.dir);
    add(v.b.id, { x: -v.dir.x, y: -v.dir.y });
  });

  // For each (node, wall): corner on the "plus" side (rotate outgoing dir by +90°) and "minus" side
  const plus = new Map<string, Pt>();
  const minus = new Map<string, Pt>();
  const key = (nid: number, wi: number) => `${nid}:${wi}`;
  const hubs: FloorWallGeom['hubs'] = [];

  for (const [nid, list] of spokes) {
    const node = nodeById.get(nid)!;
    list.sort((p, q) => p.angle - q.angle);
    const k = list.length;
    if (k === 1) {
      const s = list[0];
      plus.set(key(nid, s.wallIdx), { x: node.x - s.d.y * s.half, y: node.y + s.d.x * s.half });
      minus.set(key(nid, s.wallIdx), { x: node.x + s.d.y * s.half, y: node.y - s.d.x * s.half });
      continue;
    }
    const corners: Pt[] = [];
    for (let i = 0; i < k; i++) {
      const si = list[i], sj = list[(i + 1) % k];
      // plus side of si: n+ = (-d.y, d.x); minus side of sj: n- = (d.y, -d.x)
      const pi = { x: node.x - si.d.y * si.half, y: node.y + si.d.x * si.half };
      const pj = { x: node.x + sj.d.y * sj.half, y: node.y - sj.d.x * sj.half };
      let c = intersect(pi, si.d, pj, sj.d);
      const limit = MITER_LIMIT * Math.max(si.half, sj.half);
      if (!c || Math.hypot(c.x - node.x, c.y - node.y) > limit) {
        c = { x: (pi.x + pj.x) / 2, y: (pi.y + pj.y) / 2 };
      }
      plus.set(key(nid, si.wallIdx), c);
      minus.set(key(nid, sj.wallIdx), c);
      corners.push(c);
    }
    if (k >= 3) hubs.push({ polygon: corners, exterior: list.some(s => valid[s.wallIdx].wall.exterior) });
  }

  const rooms = roomSides(valid.map(v => ({ a: v.a, b: v.b })));

  const result: WallGeom[] = valid.map((v, i) => {
    // Left side (n+ of A→B): at A it is the plus corner, at B (outgoing dir reversed) the minus corner
    const la = plus.get(key(v.a.id, i))!;
    const lb = minus.get(key(v.b.id, i))!;
    const ra = minus.get(key(v.a.id, i))!;
    const rb = plus.get(key(v.b.id, i))!;
    const along = (p: Pt, q: Pt) => (q.x - p.x) * v.dir.x + (q.y - p.y) * v.dir.y;
    return {
      wall: v.wall,
      a: v.a,
      b: v.b,
      dir: v.dir,
      normal: { x: -v.dir.y, y: v.dir.x },
      length: v.length,
      thickness: v.half * 2,
      left: { a: la, b: lb, length: Math.max(0, along(la, lb)), room: rooms[i].left },
      right: { a: ra, b: rb, length: Math.max(0, along(ra, rb)), room: rooms[i].right },
      polygon: [la, lb, rb, ra],
      freeA: (spokes.get(v.a.id)?.length ?? 0) === 1,
      freeB: (spokes.get(v.b.id)?.length ?? 0) === 1,
    };
  });

  return { walls: result, hubs };
}

/**
 * Finds which side of each wall faces an enclosed room, by walking the faces
 * of the planar wall graph. A face with positive signed area is enclosed;
 * the outer boundary of each connected group of walls has negative area.
 */
export function roomSides(edges: { a: WallNode; b: WallNode }[]): { left: boolean; right: boolean }[] {
  // Half-edge h = 2*i (A→B, face on its left) and 2*i+1 (B→A, i.e. the right side of the wall)
  const from = (h: number) => (h % 2 === 0 ? edges[h >> 1].a : edges[h >> 1].b);
  const to = (h: number) => (h % 2 === 0 ? edges[h >> 1].b : edges[h >> 1].a);

  const outgoing = new Map<number, { h: number; angle: number }[]>();
  for (let h = 0; h < edges.length * 2; h++) {
    const f = from(h), t = to(h);
    const list = outgoing.get(f.id) ?? [];
    list.push({ h, angle: Math.atan2(t.y - f.y, t.x - f.x) });
    outgoing.set(f.id, list);
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  const next = (h: number): number => {
    // Arrive at v; reverse half-edge is v→u. Next = outgoing edge with the largest angle below angle(v→u), cyclic.
    const rev = h ^ 1;
    const list = outgoing.get(to(h).id)!;
    const idx = list.findIndex(o => o.h === rev);
    return list[(idx - 1 + list.length) % list.length].h;
  };

  const faceArea = new Float64Array(edges.length * 2);
  const visited = new Uint8Array(edges.length * 2);
  for (let start = 0; start < edges.length * 2; start++) {
    if (visited[start]) continue;
    const cycle: number[] = [];
    let h = start;
    let area = 0;
    let guard = 0;
    while (!visited[h] && guard++ < edges.length * 2 + 1) {
      visited[h] = 1;
      cycle.push(h);
      const p = from(h), q = to(h);
      area += p.x * q.y - q.x * p.y;
      h = next(h);
    }
    for (const c of cycle) faceArea[c] = area / 2;
  }

  return edges.map((_, i) => ({ left: faceArea[2 * i] > 1, right: faceArea[2 * i + 1] > 1 }));
}
