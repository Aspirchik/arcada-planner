/** Suspended ceiling grids: panel edges, cells, panel counts (pure) */
import type { CeilingGrid, CeilingMarkKind } from '../types';
import type { Pt } from './hit';

export const CEILING_MARKS: CeilingMarkKind[] = ['lamp', 'ac', 'vent', 'cable', 'hatch'];
export const DEFAULT_CEILING_CELL = 60;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Panel edges along one side of a grid: the start, the end of the first (edge) panel, then one edge per
 * standard panel; the last panel takes what is left. A sliver under 0.5 cm joins the panel before it.
 */
export function panelEdges(start: number, size: number, first: number, cell: number): number[] {
  const end = start + size;
  const out = [start];
  const step = Math.max(cell, 1);
  for (let v = start + Math.min(Math.max(first, 1), size); v < end - 0.5; v += step) out.push(r1(v));
  out.push(end);
  return out;
}

/** Column (x) and row (y) edges of a grid */
export function ceilingEdges(g: CeilingGrid): { xs: number[]; ys: number[] } {
  return { xs: panelEdges(g.x, g.w, g.firstW, g.cellW), ys: panelEdges(g.y, g.h, g.firstH, g.cellH) };
}

/** Size of the last panel along a side */
export function lastPanel(edges: number[]): number {
  return r1(edges[edges.length - 1] - edges[edges.length - 2]);
}

/** First panel size that makes the last one `last` (the panels in between are standard) */
export function firstForLast(size: number, cell: number, last: number): number {
  const rest = size - last;
  if (rest < 0.5) return size;
  const r = r1(rest - Math.floor(rest / cell) * cell);
  return r < 0.5 || cell - r < 0.5 ? Math.min(cell, rest) : r;
}

/** Cell (column, row) under a point, or null when the point is outside the grid */
export function cellAt(g: CeilingGrid, p: Pt): { c: number; r: number } | null {
  if (p.x < g.x || p.x > g.x + g.w || p.y < g.y || p.y > g.y + g.h) return null;
  const { xs, ys } = ceilingEdges(g);
  const idx = (edges: number[], v: number) => {
    for (let i = 0; i < edges.length - 1; i++) if (v < edges[i + 1]) return i;
    return edges.length - 2;
  };
  return { c: idx(xs, p.x), r: idx(ys, p.y) };
}

/** Topmost grid containing the point */
export function hitCeiling(grids: CeilingGrid[], p: Pt): CeilingGrid | null {
  for (let i = grids.length - 1; i >= 0; i--) if (cellAt(grids[i], p)) return grids[i];
  return null;
}

/** Marks that lie inside the grid (marks left outside after a resize are kept but not shown) */
export function shownMarks(g: CeilingGrid): NonNullable<CeilingGrid['marks']> {
  const { xs, ys } = ceilingEdges(g);
  return (g.marks ?? []).filter(m => m.c < xs.length - 1 && m.r < ys.length - 1);
}

/** Panels by size, larger side first ("60 × 30" and "30 × 60" are the same panel), most common first */
export function panelCounts(g: CeilingGrid): { a: number; b: number; n: number }[] {
  const { xs, ys } = ceilingEdges(g);
  const map = new Map<string, { a: number; b: number; n: number }>();
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const w = r1(xs[i + 1] - xs[i]), h = r1(ys[j + 1] - ys[j]);
    const a = Math.max(w, h), b = Math.min(w, h), key = `${a}x${b}`;
    const e = map.get(key) ?? { a, b, n: 0 };
    e.n++;
    map.set(key, e);
  }
  return [...map.values()].sort((p, q) => q.n - p.n || q.a * q.b - p.a * p.b);
}

/** How many cells carry each mark */
export function markCounts(g: CeilingGrid): Map<CeilingMarkKind, number> {
  const out = new Map<CeilingMarkKind, number>();
  for (const m of shownMarks(g)) out.set(m.kind, (out.get(m.kind) ?? 0) + 1);
  return out;
}

/** The marks with the cell set to `kind` (the same kind again, or null, clears it) */
export function toggleMark(marks: CeilingGrid['marks'], c: number, r: number, kind: CeilingMarkKind | null): NonNullable<CeilingGrid['marks']> {
  const list = marks ?? [];
  const had = list.find(m => m.c === c && m.r === r);
  const rest = list.filter(m => m !== had);
  return !kind || had?.kind === kind ? rest : [...rest, { c, r, kind }];
}
