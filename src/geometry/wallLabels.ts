/** Wall length labels: which faces get a label and where (pure, shared by the canvas and export) */
import type { WallGeom, WallFace } from './walls';
import type { WallLabelMode } from '../prefs';
import type { Pt } from './hit';
import { METER } from '../constants';

export const LABEL_SIZE = 11;
const LABEL_GAP = 4;
const MIN_LABEL_LEN = 30;

export function formatMeters(len: number, unit: string): string {
  return `${Math.max(0, len / METER).toFixed(2)} ${unit}`;
}

/** Where wall length labels go for a wall: centre point, wall angle (deg) and the length to show */
export function wallLabelSpecs(g: WallGeom, mode: WallLabelMode): { p: Pt; angle: number; length: number }[] {
  if (mode === 'off') return [];
  const angle = Math.atan2(g.dir.y, g.dir.x) * 180 / Math.PI;
  if (mode === 'axis') {
    if (g.length < MIN_LABEL_LEN) return [];
    const off = g.thickness / 2 + LABEL_GAP + LABEL_SIZE / 2;
    return [{ p: { x: (g.a.x + g.b.x) / 2 + g.normal.x * off, y: (g.a.y + g.b.y) / 2 + g.normal.y * off }, angle, length: g.length }];
  }
  let showLeft: boolean, showRight: boolean;
  if (mode === 'both' || (!g.left.room && !g.right.room)) {
    // Not part of a room yet (e.g. while drawing): show both faces, once if they are equal
    showLeft = true;
    showRight = Math.abs(g.left.length - g.right.length) >= 0.5;
  } else {
    showLeft = g.left.room;
    showRight = g.right.room;
  }
  const out: { p: Pt; angle: number; length: number }[] = [];
  const face = (f: WallFace, side: 1 | -1) => {
    if (f.length < MIN_LABEL_LEN) return;
    const off = LABEL_GAP + LABEL_SIZE / 2;
    out.push({ p: { x: (f.a.x + f.b.x) / 2 + g.normal.x * off * side, y: (f.a.y + f.b.y) / 2 + g.normal.y * off * side }, angle, length: f.length });
  };
  if (showLeft) face(g.left, 1);
  if (showRight) face(g.right, -1);
  return out;
}

