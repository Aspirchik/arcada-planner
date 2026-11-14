import type { FurnitureItem } from './types';

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function angleDeg(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
}

/** Transform a point from item-local space to world space (accounting for rotation around item origin) */
export function localToWorld(lx: number, ly: number, ox: number, oy: number, rotDeg: number): { x: number; y: number } {
  const rad = rotDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: ox + lx * cos - ly * sin, y: oy + lx * sin + ly * cos };
}

/** Transform a point from world space to item-local space */
export function worldToLocal(wx: number, wy: number, ox: number, oy: number, rotDeg: number): { x: number; y: number } {
  const rad = -rotDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = wx - ox;
  const dy = wy - oy;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** Furniture in drawing order: by layer (zi), ties keep their original order */
export function sortByZ(items: FurnitureItem[]): FurnitureItem[] {
  return items.map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.zi - b.it.zi || a.i - b.i)
    .map(x => x.it);
}
